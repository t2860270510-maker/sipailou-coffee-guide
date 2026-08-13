import { noStoreJson } from "../../../../lib/api-error";
import { clearSessionCookie, validMutationOrigin } from "../../../../lib/admin-auth";

export async function POST(request: Request) {
  if (!validMutationOrigin(request)) return noStoreJson({ error: { code: "INVALID_ORIGIN", message: "请求来源校验失败。" } }, { status: 403 });
  const response = noStoreJson({ ok: true });
  response.headers.set("Set-Cookie", clearSessionCookie());
  return response;
}
