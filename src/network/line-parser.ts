/** 单条消息（一行 JSON）的长度上限：防止客户端发送永不换行的大包把房主进程内存吃爆。 */
export const MAX_LINE_CHARS = 1024 * 1024;

export class LineTooLongError extends Error {
  constructor(readonly limit: number) {
    super(`单条消息超过长度上限（${limit} 字符）`);
    this.name = "LineTooLongError";
  }
}

export class JsonLineParser<T> {
  private buffer = "";

  constructor(private readonly maxLineChars: number = MAX_LINE_CHARS) {}

  push(chunk: string): T[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    const messages: T[] = [];
    for (const line of lines) {
      if (line.length > this.maxLineChars) {
        throw new LineTooLongError(this.maxLineChars);
      }
      if (line.trim().length > 0) {
        messages.push(JSON.parse(line) as T);
      }
    }
    // 尚未换行的残行同样受限：否则一条永不结束的超长行仍会无限增长。
    if (this.buffer.length > this.maxLineChars) {
      throw new LineTooLongError(this.maxLineChars);
    }
    return messages;
  }
}
