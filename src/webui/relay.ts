import { createServer as createHttpServer, IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import { createConnection, Socket } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { JsonLineParser } from "../network/line-parser.js";
import { attachWebSocketServer, WsConnection } from "./websocket-server.js";

/**
 * WebUI 中继：浏览器（WebSocket）<-> 游戏服务器（TCP）。
 * 每个 WebSocket 连接对应一条到游戏服务器的 TCP 连接，消息双向透传：
 * WS 文本消息 -> 追加换行写入 TCP；TCP 的 JSON 行 -> 逐条作为 WS 文本消息发送。
 * 协议完全复用联机 TCP 协议，服务器端无需任何改动。
 */

export type RelayOptions = {
  gameHost: string;
  gamePort: number;
  webPort: number;
  staticDir: string;
  host?: string;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export type RelayServer = {
  httpServer: HttpServer;
  port: number;
  close(): Promise<void>;
};

export const startRelay = async (options: RelayOptions): Promise<RelayServer> => {
  const staticDir = resolve(options.staticDir);
  const serveStatic = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const urlPath = (req.url ?? "/").split("?")[0] ?? "/";
    const relative = urlPath === "/" ? "index.html" : urlPath.slice(1);
    const filePath = normalize(join(staticDir, relative));
    if (!filePath.startsWith(staticDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  };
  const httpServer = createHttpServer((req, res) => {
    void serveStatic(req, res);
  });

  attachWebSocketServer(httpServer, "/ws", (ws) => pipeToGame(ws, options));

  await new Promise<void>((resolveListen, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.webPort, options.host ?? "0.0.0.0", () => resolveListen());
  });
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : options.webPort;
  return {
    httpServer,
    port,
    close: () =>
      new Promise<void>((resolveClose) => {
        httpServer.close(() => resolveClose());
      }),
  };
};

const pipeToGame = (ws: WsConnection, options: RelayOptions): void => {
  const tcp: Socket = createConnection({ host: options.gameHost, port: options.gamePort });
  const parser = new JsonLineParser<{ type: string }>();
  let tcpReady = false;
  const pending: string[] = [];
  const flush = (): void => {
    while (tcpReady && pending.length > 0 && !tcp.destroyed) {
      const text = pending.shift();
      if (text !== undefined) {
        tcp.write(`${text}\n`);
      }
    }
  };
  tcp.setEncoding("utf8");
  tcp.on("connect", () => {
    tcpReady = true;
    flush();
  });
  tcp.on("data", (chunk: string) => {
    for (const message of parser.push(chunk)) {
      ws.send(JSON.stringify(message));
    }
  });
  tcp.on("error", () => ws.close());
  tcp.on("close", () => ws.close());
  ws.on("message", (text) => {
    let payload = text;
    try {
      const parsed = JSON.parse(text) as { type?: string; machineId?: string };
      if (parsed?.type === "source") {
        // 透传浏览器机器标识，并补上服务器看不到的浏览器真实 IP，供服务器算 sha1(IP:机器ID)
        payload = JSON.stringify({ type: "source", ip: ws.remoteAddress, machineId: String(parsed.machineId ?? "") });
      }
    } catch {
      // 非 JSON 消息原样转发
    }
    pending.push(payload);
    flush();
  });
  ws.on("close", () => {
    tcp.destroy();
  });
  ws.on("error", () => {
    tcp.destroy();
  });
};

const valueOf = (name: string, fallback: string): string =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

if (import.meta.url === `file://${process.argv[1]}`) {
  const gameHost = valueOf("host", "127.0.0.1");
  const gamePort = Number.parseInt(valueOf("port", "9527"), 10);
  const webPort = Number.parseInt(valueOf("web-port", "8080"), 10);
  const staticDir = valueOf("static", "webui");
  if (!Number.isInteger(gamePort) || gamePort < 1 || gamePort > 65535) throw new Error("--port 无效");
  if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) throw new Error("--web-port 无效");
  const relay = await startRelay({ gameHost, gamePort, webPort, staticDir });
  console.log(`WebUI 已启动：http://localhost:${relay.port}（转发到游戏服务器 ${gameHost}:${gamePort}，静态目录 ${resolve(staticDir)}）`);
}
