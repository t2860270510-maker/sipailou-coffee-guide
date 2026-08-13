import { revalidatePath } from "next/cache";
import { z } from "zod";

import { apiError, noStoreJson } from "../../../../lib/api-error";
import { authorizeAdmin } from "../../../../lib/admin-api";
import { readJsonWithLimit } from "../../../../lib/admin-auth";
import { publishDraft } from "../../../../lib/data/service";
import { overlaySchema } from "../../../../lib/data/schema";

const schema = z.object({ overlay: overlaySchema, pointerEtag: z.string().nullable() }).strict();

export async function POST(request: Request) {
  const auth = authorizeAdmin(request, { mutation: true, json: true });
  if ("response" in auth) return auth.response;
  try {
    const body = schema.parse(await readJsonWithLimit(request, 512 * 1024));
    const result = await publishDraft(body.overlay, auth.session.name, body.pointerEtag);
    revalidatePath("/");
    return noStoreJson(result);
  } catch (error) {
    if (error instanceof Error && error.message === "etag_conflict") return apiError(409, "ETAG_CONFLICT", "发布版本已变化，请刷新差异后重试。");
    if (error instanceof Error && error.message === "body_too_large") return apiError(413, "BODY_TOO_LARGE", "发布内容超过 512 KiB。");
    return apiError(400, "PUBLISH_VALIDATION_FAILED", error instanceof Error ? error.message.slice(0, 180) : "发布校验失败。");
  }
}
