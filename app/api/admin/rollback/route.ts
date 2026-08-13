import { revalidatePath } from "next/cache";
import { z } from "zod";

import { apiError, noStoreJson } from "../../../../lib/api-error";
import { authorizeAdmin } from "../../../../lib/admin-api";
import { readJsonWithLimit } from "../../../../lib/admin-auth";
import { rollbackRelease } from "../../../../lib/data/service";

const schema = z.object({ releasePath: z.string().startsWith("coffee-data/releases/").max(500), pointerEtag: z.string().min(1).max(500) }).strict();

export async function POST(request: Request) {
  const auth = authorizeAdmin(request, { mutation: true, json: true });
  if ("response" in auth) return auth.response;
  try {
    const body = schema.parse(await readJsonWithLimit(request, 8 * 1024));
    const result = await rollbackRelease(body.releasePath, auth.session.name, body.pointerEtag);
    revalidatePath("/");
    return noStoreJson(result);
  } catch (error) {
    if (error instanceof Error && error.message === "etag_conflict") return apiError(409, "ETAG_CONFLICT", "当前发布版本已变化，请刷新后重试。");
    return apiError(400, "ROLLBACK_FAILED", "回退失败，请确认目标版本仍然有效。");
  }
}
