import { createHash } from "node:crypto";
import { Server as HttpServer } from "node:http";
import { Socket } from "node:net";

/**
 * 最小 WebSocket 服务端（RFC 6455）：仅支持文本消息，无扩展、无压缩。
 * 零依赖实现，供 WebUI 中继（relay）使用；浏览器端 WebSocket 客户端可正常互通。
 */

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export type WsEventMap = {
  message: (text: string) => void;
  close: () => void;
  error: (error: Error) => void;
};

export type WsConnection = {
  /** 浏览器对端地址（已归一化，去掉 IPv6 前缀），供中继计算来源指纹。 */
  readonly remoteAddress: string;
  send(text: string): void;
  close(): void;
  on<K extends keyof WsEventMap>(event: K, listener: WsEventMap[K]): void;
};

type ParsedFrame = {
  opcode: number;
  fin: boolean;
  payload: Buffer;
  consumed: number;
};

const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** 从缓冲区头部解析一帧；数据不足返回 null。 */
const tryParseFrame = (buffer: Buffer): ParsedFrame | null => {
  if (buffer.length < 2) {
    return null;
  }
  const b0 = buffer[0] ?? 0;
  const b1 = buffer[1] ?? 0;
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let length = b1 & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) {
      return null;
    }
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) {
      return null;
    }
    const bigLength = buffer.readBigUInt64BE(2);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("websocket 帧过长");
    }
    length = Number(bigLength);
    offset = 10;
  }
  let maskKey: Buffer | null = null;
  if (masked) {
    if (buffer.length < offset + 4) {
      return null;
    }
    maskKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) {
    return null;
  }
  const raw = buffer.subarray(offset, offset + length);
  const payload = maskKey
    ? Buffer.from(raw.map((byte, index) => byte ^ (maskKey[index % 4] ?? 0)))
    : Buffer.from(raw);
  return { opcode, fin, payload, consumed: offset + length };
};

const encodeFrame = (opcode: number, payload: Buffer, fin: boolean): Buffer => {
  let header: Buffer;
  const length = payload.length;
  if (length < 126) {
    header = Buffer.from([(fin ? 0x80 : 0) | opcode, length]);
  } else if (length < 0x1_0000) {
    header = Buffer.alloc(4);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
};

class WsConnectionImpl implements WsConnection {
  readonly remoteAddress: string;
  private readonly listeners: { [K in keyof WsEventMap]?: Array<WsEventMap[K]> } = {};
  private buffer = Buffer.alloc(0);
  private fragment: Buffer | null = null;
  private closed = false;

  constructor(private readonly socket: Socket) {
    this.remoteAddress = (socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
    socket.setNoDelay(true);
    socket.on("data", (chunk: Buffer) => this.handleData(chunk));
    socket.on("error", () => this.emit("close"));
    socket.on("close", () => this.emit("close"));
  }

  on<K extends keyof WsEventMap>(event: K, listener: WsEventMap[K]): void {
    const bucket = (this.listeners[event] ??= []) as Array<WsEventMap[K]>;
    bucket.push(listener);
  }

  /** 握手后立即到达的首批帧（HTTP upgrade 事件的 head 缓冲区）。 */
  feed(head: Buffer): void {
    if (head.length > 0) {
      this.handleData(head);
    }
  }

  send(text: string): void {
    if (this.closed) {
      return;
    }
    this.socket.write(encodeFrame(OP_TEXT, Buffer.from(text, "utf8"), true));
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.socket.write(encodeFrame(OP_CLOSE, Buffer.from([0x03, 0xe8]), true));
    this.socket.end();
  }

  private emit(event: "message", arg: string): void;
  private emit(event: "close"): void;
  private emit(event: "error", arg: Error): void;
  private emit(event: keyof WsEventMap, ...args: unknown[]): void {
    for (const listener of this.listeners[event] ?? []) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  }

  private handleData(chunk: Buffer): void {
    if (this.closed) {
      return;
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      let frame: ParsedFrame | null;
      try {
        frame = tryParseFrame(this.buffer);
      } catch {
        this.closeWithError(1002, "协议错误");
        return;
      }
      if (!frame) {
        return;
      }
      this.buffer = this.buffer.subarray(frame.consumed);
      this.handleFrame(frame);
      if (this.closed) {
        return;
      }
    }
  }

  private handleFrame(frame: ParsedFrame): void {
    if (frame.opcode === OP_PING) {
      this.socket.write(encodeFrame(OP_PONG, frame.payload, true));
      return;
    }
    if (frame.opcode === OP_PONG) {
      return;
    }
    if (frame.opcode === OP_CLOSE) {
      this.close();
      return;
    }
    if (frame.opcode === OP_BINARY) {
      this.closeWithError(1003, "不支持二进制消息");
      return;
    }
    if (frame.opcode === OP_TEXT || frame.opcode === 0x0) {
      if (frame.opcode === OP_TEXT && this.fragment) {
        this.closeWithError(1002, "文本帧之间出现续帧");
        return;
      }
      if (frame.fin) {
        const message = frame.opcode === OP_TEXT ? frame.payload : Buffer.concat([this.fragment ?? Buffer.alloc(0), frame.payload]);
        this.fragment = null;
        this.emit("message", message.toString("utf8"));
      } else {
        this.fragment = Buffer.concat([this.fragment ?? Buffer.alloc(0), frame.payload]);
      }
      return;
    }
    this.closeWithError(1002, `未知操作码 ${frame.opcode}`);
  }

  private closeWithError(code: number, reason: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason, "utf8"));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2, "utf8");
    this.socket.write(encodeFrame(OP_CLOSE, payload, true));
    this.socket.end();
    this.emit("error", new Error(reason));
    this.emit("close");
  }
}

/**
 * 在既有 http.Server 上挂载 WebSocket 端点。
 * @param path 例如 "/ws"，浏览器通过 ws://host/path 连接
 */
export const attachWebSocketServer = (server: HttpServer, path: string, onConnection: (ws: WsConnection) => void): void => {
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== path || (req.headers.upgrade ?? "").toLowerCase() !== "websocket") {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const ws = new WsConnectionImpl(socket as Socket);
    onConnection(ws);
    ws.feed(head);
  });
};
