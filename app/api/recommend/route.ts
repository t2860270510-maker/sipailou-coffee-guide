import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getPublicCoffeeSnapshot } from "../../../lib/data/service";
import { explainRecommendation, isDeepSeekConfigured } from "../../../lib/deepseek";
import { buildRecommendation } from "../../../lib/recommendation";
import { encodeSseEvent } from "../../../lib/sse";
import { recordMetric } from "../../../lib/metrics";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 12 * 1024;
const MAX_INSTANCE_CONCURRENCY = 12;
const MAX_IP_CONCURRENCY = 2;

const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(600),
  selectedCafeIds: z.array(z.string().max(80)).max(2).optional(),
});

const requestSchema = z.object({
  query: z.string().trim().min(2, "请至少输入 2 个字。 ").max(400, "需求最多 400 个字。"),
  history: z.array(historyMessageSchema).max(6, "最多携带最近 6 条消息。").optional().default([]),
  location: z
    .object({
      longitude: z.number().min(-180).max(180),
      latitude: z.number().min(-90).max(90),
      distances: z
        .record(z.string(), z.object({ distanceM: z.number().nonnegative().max(100_000), durationMin: z.number().positive().max(1_000) }))
        .optional(),
    })
    .optional(),
});

const activeByIp = new Map<string, number>();
let activeRequests = 0;

function errorResponse(status: number, code: string, message: string, requestId: string, retryAfter?: number) {
  const response = NextResponse.json({ error: { code, message, requestId } }, { status });
  response.headers.set("Cache-Control", "no-store");
  if (retryAfter) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || "unknown").trim();
}

function acquire(ip: string) {
  if ((activeByIp.get(ip) ?? 0) >= MAX_IP_CONCURRENCY) return "ip" as const;
  if (activeRequests >= MAX_INSTANCE_CONCURRENCY) return "instance" as const;
  activeByIp.set(ip, (activeByIp.get(ip) ?? 0) + 1);
  activeRequests += 1;
  return "ok" as const;
}

function release(ip: string) {
  const next = Math.max(0, (activeByIp.get(ip) ?? 1) - 1);
  if (next) activeByIp.set(ip, next);
  else activeByIp.delete(ip);
  activeRequests = Math.max(0, activeRequests - 1);
}

async function readLimitedJson(request: Request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw new Error("body_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error("body_too_large");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("invalid_json");
  }
}

function tokenChunks(text: string) {
  const chunks = text.match(/[\s\S]{1,24}/g);
  return chunks?.length ? chunks : [text];
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return errorResponse(415, "UNSUPPORTED_MEDIA_TYPE", "请求必须使用 JSON 格式。", requestId);
  }

  let payload: z.infer<typeof requestSchema>;
  try {
    payload = requestSchema.parse(await readLimitedJson(request));
  } catch (error) {
    if (error instanceof Error && error.message === "body_too_large") return errorResponse(413, "BODY_TOO_LARGE", "请求内容超过 12 KiB。", requestId);
    if (error instanceof z.ZodError) return errorResponse(400, "INVALID_REQUEST", error.issues[0]?.message ?? "请求格式不正确。", requestId);
    return errorResponse(400, "INVALID_JSON", "请求不是有效的 JSON。", requestId);
  }

  const ip = clientIp(request);
  const capacity = acquire(ip);
  if (capacity === "ip") return errorResponse(429, "TOO_MANY_CONCURRENT_REQUESTS", "同一网络的并发请求过多，请稍后再试。", requestId, 2);
  if (capacity === "instance") return errorResponse(503, "SERVICE_BUSY", "推荐服务正忙，请稍后再试。", requestId, 2);

  const snapshot = await getPublicCoffeeSnapshot();
  const recommendation = buildRecommendation({
    cafes: snapshot.cafes,
    query: payload.query,
    history: payload.history,
    location: payload.location,
  });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
      try {
        send("meta", { requestId, protocol: "coffee-recommendation-sse-v1", dataVersion: snapshot.version, dataSource: snapshot.source, dataDegraded: snapshot.degraded });
        send("phase", { phase: "rules_complete", message: "已经按条件筛选店铺" });
        send("recommendations", {
          selectedCafeIds: recommendation.selectedCafeIds,
          localText: recommendation.explanation,
          summary: recommendation.parsedRequestSummary,
          picks: recommendation.topPicks,
          excluded: recommendation.excluded.map((item) => ({
            cafeId: item.cafe.id,
            name: item.cafe.name,
            score: item.score,
            reasons: item.tradeoffs,
            hardExclusions: item.hardExclusions,
          })),
          relaxationAdvice: recommendation.relaxationAdvice,
        });
        send(
          "sources",
          recommendation.topPicks.map((pick) => ({
            cafeId: pick.cafe.id,
            sourceLabel: pick.cafe.sourceLabel,
            sourceUrl: pick.cafe.sourceUrl,
            verifiedAt: pick.cafe.verifiedAt,
            verifiedBy: pick.cafe.verifiedBy,
          })),
        );
        send("phase", { phase: "explaining", message: isDeepSeekConfigured() ? "正在整理两家店的取舍" : "模型未配置，使用本地完整推荐" });

        const outcome = await explainRecommendation(recommendation, snapshot.cafes);
        for (const token of tokenChunks(outcome.text)) send("token", { text: token });
        if (outcome.fallbackReason) {
          send("error", {
            error: {
              code: "MODEL_FALLBACK",
              message: "自然语言服务暂不可用，已使用本地规则生成完整推荐。",
              requestId,
            },
          });
        }
        send("done", {
          requestId,
          modelUsed: outcome.modelUsed,
          degraded: outcome.modelUsed === "local",
          selectedCafeIds: recommendation.selectedCafeIds,
        });
        recordMetric("recommendation_complete", {
          durationMs: Date.now() - startedAt,
          modelResult: outcome.modelUsed,
          fallbackReason: outcome.fallbackReason,
          selectedCount: recommendation.selectedCafeIds.length,
          dataSource: snapshot.source,
        });
      } catch {
        send("error", { error: { code: "STREAM_ERROR", message: "推荐流中断，已保留本地推荐。", requestId } });
        send("done", { requestId, modelUsed: "local", degraded: true, selectedCafeIds: recommendation.selectedCafeIds });
        recordMetric("recommendation_error", { durationMs: Date.now() - startedAt, selectedCount: recommendation.selectedCafeIds.length });
      } finally {
        release(ip);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Request-Id": requestId,
    },
  });
}
