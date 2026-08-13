import { z } from "zod";

import { apiError, noStoreJson } from "../../../../lib/api-error";
import { authorizeAdmin } from "../../../../lib/admin-api";
import { readJsonWithLimit } from "../../../../lib/admin-auth";
import { getPublishedPointer, validateOverlayForPublish } from "../../../../lib/data/service";
import { overlaySchema } from "../../../../lib/data/schema";

const schema = z.object({ overlay: overlaySchema }).strict();

export async function POST(request: Request) {
  const auth = authorizeAdmin(request, { mutation: true, json: true });
  if ("response" in auth) return auth.response;
  try {
    const body = schema.parse(await readJsonWithLimit(request, 512 * 1024));
    const pointer = await getPublishedPointer();
    const result = validateOverlayForPublish(body.overlay, pointer.pointer?.publishedCafeIds ?? []);
    return noStoreJson({ valid: true, activeCafeCount: result.cafes.filter((cafe) => cafe.status === "active").length, cafeCount: result.cafes.length });
  } catch (error) {
    if (error instanceof Error && error.message === "body_too_large") return apiError(413, "BODY_TOO_LARGE", "草稿超过 512 KiB。");
    return apiError(400, "VALIDATION_FAILED", error instanceof Error ? error.message.slice(0, 180) : "严格校验失败。");
  }
}
