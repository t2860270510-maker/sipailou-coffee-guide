import { describe, expect, it } from "vitest";

import { encodeSseEvent, safeParseEventData, SseParseError, SseParser } from "../lib/sse";

describe("SSE parser", () => {
  it("parses UTF-8 split across arbitrary byte boundaries", () => {
    const source = new TextEncoder().encode(encodeSseEvent("token", { text: "四牌楼☕" }));
    const events: Array<{ event: string; data: string }> = [];
    const parser = new SseParser((event) => events.push(event));
    for (const byte of source) parser.feed(Uint8Array.of(byte));
    parser.end();
    expect(events).toHaveLength(1);
    expect(safeParseEventData<{ text: string }>(events[0].data)?.text).toBe("四牌楼☕");
  });

  it("handles BOM, CRLF, comments and multiline data", () => {
    const events: string[] = [];
    const parser = new SseParser((event) => events.push(event.data));
    parser.feed("\uFEFF: keep-alive\r\nevent: token\r\ndata: first\r\ndata: second\r\n\r\n");
    parser.end();
    expect(events).toEqual(["first\nsecond"]);
  });

  it("dispatches a trailing event at EOF without a blank line", () => {
    const events: string[] = [];
    const parser = new SseParser((event) => events.push(event.data));
    parser.feed("event: done\ndata: {\"ok\":true}");
    parser.end();
    expect(events).toEqual(['{"ok":true}']);
  });

  it("tolerates an empty stream", () => {
    const events: string[] = [];
    const parser = new SseParser((event) => events.push(event.data));
    parser.end();
    expect(events).toEqual([]);
  });

  it("rejects oversized events", () => {
    const parser = new SseParser(() => undefined, { maxEventBytes: 16 });
    expect(() => parser.feed(`data: ${"x".repeat(40)}\n\n`)).toThrow(SseParseError);
  });

  it("keeps damaged JSON from reaching consumers", () => {
    expect(safeParseEventData("{not-json")).toBeNull();
  });
});
