import { afterEach, describe, expect, it, vi } from "vitest";

import { cafes } from "../lib/cafes";
import { explainRecommendation, validateModelExplanation } from "../lib/deepseek";
import { buildRecommendation } from "../lib/recommendation";

const recommendation = buildRecommendation({
  cafes,
  query: "下午想坐一会写东西，最好安静一点",
  now: new Date("2026-08-12T06:00:00.000Z"),
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEEPSEEK_API_KEY;
});

describe("model explanation guardrail", () => {
  it("returns the complete local text when the key is missing", async () => {
    const result = await explainRecommendation(recommendation, cafes);
    expect(result.modelUsed).toBe("local");
    expect(result.text).toBe(recommendation.explanation);
  });

  it("accepts only the exact selected IDs", () => {
    const text = recommendation.topPicks.map((pick) => pick.cafe.name).join(" 和 ") + " 都适合这次安静写作，各有空间和距离上的取舍。";
    const valid = JSON.stringify({ selectedCafeIds: recommendation.selectedCafeIds, text });
    expect(validateModelExplanation(valid, recommendation, cafes)).toBe(text);
    const invalid = JSON.stringify({ selectedCafeIds: [...recommendation.selectedCafeIds].reverse(), text });
    expect(validateModelExplanation(invalid, recommendation, cafes)).toBeNull();
  });

  it("rejects a non-selected cafe name", () => {
    const text = `${recommendation.topPicks[0].cafe.name} 和 ${recommendation.topPicks[1].cafe.name} 都适合；也可以去 STANDING ROOM。`;
    expect(validateModelExplanation(JSON.stringify({ selectedCafeIds: recommendation.selectedCafeIds, text }), recommendation, cafes)).toBeNull();
  });

  it("rejects invented numbers", () => {
    const text = `${recommendation.topPicks[0].cafe.name} 和 ${recommendation.topPicks[1].cafe.name} 都适合，步行只要 999 分钟。`;
    expect(validateModelExplanation(JSON.stringify({ selectedCafeIds: recommendation.selectedCafeIds, text }), recommendation, cafes)).toBeNull();
  });

  it("falls back after an empty stream and empty non-stream response", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 })),
    );
    const result = await explainRecommendation(recommendation, cafes);
    expect(result.modelUsed).toBe("local");
    expect(result.text).toBe(recommendation.explanation);
  });

  it("falls back when an upstream stream ends before DONE", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const partial = `data: ${JSON.stringify({ choices: [{ delta: { content: "{\"selectedCafeIds\":" } }] })}\n\n`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(partial, { status: 200 })));
    const result = await explainRecommendation(recommendation, cafes);
    expect(result.modelUsed).toBe("local");
    expect(result.fallbackReason).toBe("model_validation_failed");
  });
});
