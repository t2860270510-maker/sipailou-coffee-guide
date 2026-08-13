export interface ParsedSseEvent {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

export class SseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SseParseError";
  }
}

export class SseParser {
  private readonly decoder = new TextDecoder("utf-8", { fatal: false });
  private readonly onEvent: (event: ParsedSseEvent) => void;
  private readonly maxEventBytes: number;
  private buffer = "";
  private dataLines: string[] = [];
  private eventName = "message";
  private eventId: string | undefined;
  private retry: number | undefined;
  private eventSize = 0;
  private started = false;

  constructor(onEvent: (event: ParsedSseEvent) => void, options?: { maxEventBytes?: number }) {
    this.onEvent = onEvent;
    this.maxEventBytes = options?.maxEventBytes ?? 256 * 1024;
  }

  feed(chunk: Uint8Array | string) {
    const text = typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    this.buffer += text;
    this.consumeLines(false);
  }

  end() {
    this.buffer += this.decoder.decode();
    this.consumeLines(true);
    if (this.buffer.length) {
      this.processLine(this.buffer.replace(/\r$/, ""));
      this.buffer = "";
    }
    this.dispatch();
  }

  private consumeLines(flush: boolean) {
    while (true) {
      const lf = this.buffer.indexOf("\n");
      if (lf < 0) break;
      const line = this.buffer.slice(0, lf).replace(/\r$/, "");
      this.buffer = this.buffer.slice(lf + 1);
      this.processLine(line);
    }
    if (flush && this.buffer.endsWith("\r")) {
      this.processLine(this.buffer.slice(0, -1));
      this.buffer = "";
    }
  }

  private processLine(rawLine: string) {
    let line = rawLine;
    if (!this.started) {
      this.started = true;
      line = line.replace(/^\uFEFF/, "");
    }
    if (line === "") {
      this.dispatch();
      return;
    }
    if (line.startsWith(":")) return;

    this.eventSize += new TextEncoder().encode(line).byteLength;
    if (this.eventSize > this.maxEventBytes) throw new SseParseError("SSE event exceeded the size limit");

    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") this.dataLines.push(value);
    else if (field === "event") this.eventName = value || "message";
    else if (field === "id" && !value.includes("\0")) this.eventId = value;
    else if (field === "retry" && /^\d+$/.test(value)) this.retry = Number(value);
  }

  private dispatch() {
    if (!this.dataLines.length) {
      this.resetEvent();
      return;
    }
    this.onEvent({
      event: this.eventName,
      data: this.dataLines.join("\n"),
      id: this.eventId,
      retry: this.retry,
    });
    this.resetEvent();
  }

  private resetEvent() {
    this.dataLines = [];
    this.eventName = "message";
    this.eventSize = 0;
    this.retry = undefined;
  }
}

export function encodeSseEvent(event: string, payload: unknown) {
  const data = JSON.stringify(payload).replace(/\u2028|\u2029/g, "");
  return `event: ${event}\ndata: ${data}\n\n`;
}

export function safeParseEventData<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
