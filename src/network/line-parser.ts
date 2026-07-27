export class JsonLineParser<T> {
  private buffer = "";

  push(chunk: string): T[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    const messages: T[] = [];
    for (const line of lines) {
      if (line.trim().length > 0) {
        messages.push(JSON.parse(line) as T);
      }
    }
    return messages;
  }
}
