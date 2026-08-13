import { z } from "zod";

import { apiError, noStoreJson } from "../../../../lib/api-error";
import { authorizeAdmin } from "../../../../lib/admin-api";
import { readJsonWithLimit } from "../../../../lib/admin-auth";
import { saveDraft } from "../../../../lib/data/service";
import { overlaySchema } from "../../../../lib/data/schema";

const schema = z.object({ overlay: overlaySchema, etag: z.string().nullable() }).strict();

export async function PUT(request: Request) {
  const auth = authorizeAdmin(request, { mutation: true, json: true });
  if ("response" in auth) return auth.response;
  try {
    const body = schema.parse(await readJsonWithLimit(request, 512 * 1024));
    const updated = { ...body.overlay, updatedAt: new Date().toISOString(), updatedBy: auth.session.name };
    return noStoreJson(await saveDraft(updated, body.etag));
  } catch (error) {
    if (error instanceof Error && error.message === "etag_conflict") return apiError(409, "ETAG_CONFLICT", "草稿已被其他管理员更新，请刷新后重试。");
    if (error instanceof Error && error.message === "body_too_large") return apiError(413, "BODY_TOO_LARGE", "草稿超过 512 KiB。");
    return apiError(400, "INVALID_DRAFT", "草稿校验失败，请检查字段、来源与营业时间。");
  }
}
