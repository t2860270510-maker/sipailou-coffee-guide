import { z } from "zod";

import { apiError, noStoreJson } from "../../../../lib/api-error";
import { authorizeAdmin } from "../../../../lib/admin-api";
import { readJsonWithLimit } from "../../../../lib/admin-auth";
import { applyOverlay } from "../../../../lib/data/service";
import { overlaySchema } from "../../../../lib/data/schema";
import { explainRecommendation } from "../../../../lib/deepseek";
import { buildRecommendation } from "../../../../lib/recommendation";

const schema = z.object({
  overlay: overlaySchema,
  query: z.string().trim().min(2).max(400),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(600) })).max(6).optional().default([]),
}).strict();

export async function POST(request: Request) {
  const auth = authorizeAdmin(request, { mutation: true, json: true });
  if ("response" in auth) return auth.response;
  try {
    const body = schema.parse(await readJsonWithLimit(request, 512 * 1024));
    const cafes = applyOverlay(body.overlay).filter((cafe) => cafe.status === "active");
    const recommendation = buildRecommendation({ cafes, query: body.query, history: body.history });
    const explanation = await explainRecommendation(recommendation, cafes, body.overlay.promptStyle);
    return noStoreJson({ ...recommendation, explanation: explanation.text, modelUsed: explanation.modelUsed, fallbackReason: explanation.fallbackReason });
  } catch (error) {
    if (error instanceof Error && error.message === "body_too_large") return apiError(413, "BODY_TOO_LARGE", "试聊草稿超过 512 KiB。");
    return apiError(400, "TRIAL_FAILED", "试聊失败，请先修正草稿或查询内容。");
  }
}
