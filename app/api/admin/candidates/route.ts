import { z } from "zod";

import { apiError, noStoreJson } from "../../../../lib/api-error";
import { authorizeAdmin } from "../../../../lib/admin-api";
import { readJsonWithLimit } from "../../../../lib/admin-auth";
import { cafeSchema } from "../../../../lib/data/schema";
import { generateCafeCandidates } from "../../../../lib/deepseek";

const schema = z.object({ cafe: cafeSchema }).strict();

export async function POST(request: Request) {
  const auth = authorizeAdmin(request, { mutation: true, json: true });
  if ("response" in auth) return auth.response;
  try {
    const body = schema.parse(await readJsonWithLimit(request, 96 * 1024));
    const candidates = await generateCafeCandidates(body.cafe);
    if (!candidates) return apiError(503, "MODEL_NOT_CONFIGURED", "DeepSeek 未配置，暂不能生成文案候选。");
    return noStoreJson({ candidates, applied: false, published: false });
  } catch {
    return apiError(502, "CANDIDATE_GENERATION_FAILED", "文案候选生成失败，未修改草稿。");
  }
}
