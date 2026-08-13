import { afterEach, describe, expect, it } from "vitest";

import { POST } from "../app/api/recommend/route";
import { safeParseEventData, SseParser } from "../lib/sse";

afterEach(() => { delete process.env.DEEPSEEK_API_KEY; });

async function request(body: unknown, contentType = "application/json") {
  return POST(new Request("http://localhost/api/recommend", {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": `test-${Math.random()}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

describe("POST /api/recommend", () => {
  it("emits the fixed protocol and a complete deterministic fallback", async () => {
    const response = await request({ query: "下午想坐一会写东西，最好安静一点", history: [] });
    expect(response.status).toBe(200);
    const eventNames: string[] = [];
    let recommendations: { selectedCafeIds: string[]; localText: string } | null = null;
    let done: { selectedCafeIds: string[]; degraded: boolean } | null = null;
    const parser = new SseParser((event) => {
      eventNames.push(event.event);
      if (event.event === "recommendations") recommendations = safeParseEventData(event.data);
      if (event.event === "done") done = safeParseEventData(event.data);
    });
    parser.feed(new Uint8Array(await response.arrayBuffer()));
    parser.end();
    expect(eventNames.slice(0, 5)).toEqual(["meta", "phase", "recommendations", "sources", "phase"]);
    expect(eventNames.at(-1)).toBe("done");
    expect(recommendations).not.toBeNull();
    expect(done).not.toBeNull();
    expect(done!.selectedCafeIds).toEqual(recommendations!.selectedCafeIds);
    expect(done!.degraded).toBe(true);
    expect(recommendations!.localText.length).toBeGreaterThan(50);
  });

  it("supports six history messages but rejects the seventh", async () => {
    const valid = Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `消息 ${index}` }));
    expect((await request({ query: "预算再低一点", history: valid })).status).toBe(200);
    const invalid = [...valid, { role: "user", content: "第七条" }];
    const response = await request({ query: "预算再低一点", history: invalid });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("enforces query and request body limits with a uniform error", async () => {
    const short = await request({ query: "a" });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ error: { code: "INVALID_REQUEST", requestId: expect.any(String) } });
    const large = await request(JSON.stringify({ query: "合适的咖啡", padding: "x".repeat(13 * 1024) }));
    expect(large.status).toBe(413);
    expect(await large.json()).toMatchObject({ error: { code: "BODY_TOO_LARGE" } });
  });

  it("rejects unsupported content types", async () => {
    const response = await request("query=咖啡", "application/x-www-form-urlencoded");
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });
  });

  it("does not reflect an HTML injection payload into the response", async () => {
    const response = await request({ query: "想喝咖啡<script>alert(1)</script>" });
    expect(await response.text()).not.toContain("<script>");
  });
});
