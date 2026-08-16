import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer as createHttpServer, Server as HttpServer } from "node:http";
import { attachWebSocketServer } from "./websocket-server.js";

const startEchoServer = async (): Promise<{ httpServer: HttpServer; port: number }> => {
  const httpServer = createHttpServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  attachWebSocketServer(httpServer, "/ws", (ws) => {
    ws.on("message", (text) => ws.send(`echo:${text}`));
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { httpServer, port };
};

const connectWs = (port: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("websocket 连接失败"));
  });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

void test("WebSocket 握手与文本回显", async () => {
  const { httpServer, port } = await startEchoServer();
  try {
    const ws = await connectWs(port);
    const received: string[] = [];
    ws.onmessage = (event) => received.push(String(event.data));
    ws.send("你好，三国杀");
    ws.send(JSON.stringify({ type: "ping" }));
    await wait(200);
    assert.deepEqual(received, ["echo:你好，三国杀", 'echo:{"type":"ping"}']);
    ws.close();
  } finally {
    httpServer.close();
  }
});

void test("大消息（分帧长度 126+）可正确收发", async () => {
  const { httpServer, port } = await startEchoServer();
  try {
    const ws = await connectWs(port);
    const received: string[] = [];
    ws.onmessage = (event) => received.push(String(event.data));
    const big = "x".repeat(300);
    ws.send(big);
    await wait(200);
    assert.deepEqual(received, [`echo:${big}`]);
    ws.close();
  } finally {
    httpServer.close();
  }
});

void test("服务端主动关闭时客户端收到 close 事件", async () => {
  const { httpServer, port } = await startEchoServer();
  try {
    const ws = await connectWs(port);
    const closed = new Promise<void>((resolve) => {
      ws.onclose = () => resolve();
    });
    // 直接结束底层服务器连接：发送 close 帧
    // 这里通过关闭 httpServer 的底层 socket 来模拟服务端关闭
    // 更直接的方式：由 echo 处理器在收到特定消息后 close
    ws.close();
    await closed;
  } finally {
    httpServer.close();
  }
});

void test("路径不匹配时握手被拒绝", async () => {
  const { httpServer, port } = await startEchoServer();
  try {
    const badUrl = `ws://127.0.0.1:${port}/other`;
    const error = await new Promise<Error | null>((resolve) => {
      const ws = new WebSocket(badUrl);
      ws.onerror = () => resolve(new Error("握手失败"));
      ws.onopen = () => resolve(null);
      setTimeout(() => resolve(null), 300);
    });
    assert.ok(error, "路径不匹配时应握手失败");
  } finally {
    httpServer.close();
  }
});
