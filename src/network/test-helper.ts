import { Socket, createServer } from "node:net";
import { randomUUID } from "node:crypto";
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

  /**
   * 连接并注册机器标识。默认每个客户端是独立“机器”（随机 ID）；
   * 传相同 machineId 模拟同机双开；传 null 模拟无机器标识的旧客户端。
   */
  static connect(port: number, machineId?: string | null): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      socket.on("connect", () => {
        if (machineId !== null) {
          socket.write(encodeMessage({ type: "source", machineId: machineId ?? `test-${randomUUID()}` }));
        }
        resolve(new TestClient(socket));
      });
      socket.once("error", reject);
      socket.connect(port, "127.0.0.1");
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
