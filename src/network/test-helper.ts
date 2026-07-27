import { Socket, createServer } from "node:net";
import { JsonLineParser } from "./line-parser.js";
import { ClientMessage, encodeMessage, ServerMessage } from "./protocol.js";

export type ReceivedServerMessage = ServerMessage & { receivedAt: number };

export class TestClient {
  public readonly parser = new JsonLineParser<ServerMessage>();
  public readonly messages: ReceivedServerMessage[] = [];
  public readonly socket: Socket;
  private destroyed = false;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      for (const message of this.parser.push(chunk)) {
        this.messages.push({ ...message, receivedAt: Date.now() });
      }
    });
    socket.on("close", () => { this.destroyed = true; });
    socket.on("error", () => { this.destroyed = true; });
  }

  static connect(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      socket.connect(port, "127.0.0.1", () => resolve(new TestClient(socket)));
      socket.once("error", reject);
    });
  }

  send(message: ClientMessage): void {
    this.socket.write(encodeMessage(message));
  }

  destroy(): void {
    if (!this.destroyed) { this.socket.destroy(); this.destroyed = true; }
  }

  destroyAsync(): Promise<void> {
    return new Promise((resolve) => {
      if (this.destroyed) return resolve();
      this.socket.once("close", () => resolve());
      this.socket.once("error", () => resolve());
      this.socket.destroy();
      this.destroyed = true;
    });
  }
}

export async function withTestServer<T>(opts: { run: (client: TestClient) => Promise<T> }): Promise<T> {
  const server = createServer((socket) => { socket.setEncoding("utf8"); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("test server address unavailable");
  const client = await TestClient.connect(address.port);
  try {
    return await opts.run(client);
  } finally {
    client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
