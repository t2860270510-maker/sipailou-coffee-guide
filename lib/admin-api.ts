import { apiError } from "./api-error";
import { adminAuthConfigured, isJsonRequest, sessionFromRequest, validMutationOrigin } from "./admin-auth";

export function authorizeAdmin(request: Request, options?: { mutation?: boolean; json?: boolean }) {
  if (!adminAuthConfigured()) return { response: apiError(503, "ADMIN_NOT_CONFIGURED", "管理台尚未配置。") } as const;
  const session = sessionFromRequest(request);
  if (!session) return { response: apiError(401, "ADMIN_UNAUTHORIZED", "管理会话无效或已过期。") } as const;
  if (options?.mutation && !validMutationOrigin(request)) return { response: apiError(403, "INVALID_ORIGIN", "请求来源校验失败。") } as const;
  if (options?.json && !isJsonRequest(request)) return { response: apiError(415, "UNSUPPORTED_MEDIA_TYPE", "请求必须使用 JSON 格式。") } as const;
  return { session } as const;
}
