import { z } from "zod";

import { apiError, noStoreJson } from "../../../../lib/api-error";
import { adminAuthConfigured, createSession, credentialsAreValid, isJsonRequest, readJsonWithLimit, sessionCookie, validMutationOrigin } from "../../../../lib/admin-auth";

const schema = z.object({ token: z.string().min(1).max(500), name: z.string().trim().min(1).max(80) }).strict();

export async function POST(request: Request) {
  if (!adminAuthConfigured()) return apiError(503, "ADMIN_NOT_CONFIGURED", "管理台尚未配置 ADMIN_ACCESS_TOKEN。");
  if (!validMutationOrigin(request)) return apiError(403, "INVALID_ORIGIN", "请求来源校验失败。");
  if (!isJsonRequest(request)) return apiError(415, "UNSUPPORTED_MEDIA_TYPE", "请求必须使用 JSON 格式。");
  try {
    const body = schema.parse(await readJsonWithLimit(request, 4 * 1024));
    if (!credentialsAreValid(body.token)) return apiError(401, "INVALID_CREDENTIALS", "管理口令不正确。");
    const response = noStoreJson({ ok: true, name: body.name });
    response.headers.set("Set-Cookie", sessionCookie(createSession(body.name)));
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "body_too_large") return apiError(413, "BODY_TOO_LARGE", "登录请求过大。");
    return apiError(400, "INVALID_REQUEST", "请填写管理口令和核验人姓名。");
  }
}
