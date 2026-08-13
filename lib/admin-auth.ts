import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "coffee_admin_session";
const SESSION_MS = 12 * 60 * 60 * 1000;

type AdminSession = { name: string; expiresAt: number; nonce: string };

function secret() {
  return process.env.ADMIN_ACCESS_TOKEN?.trim() || "";
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function constantTimeEqual(left: string, right: string) {
  const a = createHmac("sha256", "compare").update(left).digest();
  const b = createHmac("sha256", "compare").update(right).digest();
  return timingSafeEqual(a, b);
}

export function adminAuthConfigured() {
  return Boolean(secret());
}

export function credentialsAreValid(token: string) {
  return Boolean(secret()) && constantTimeEqual(token, secret());
}

export function createSession(name: string, now = Date.now()) {
  const session: AdminSession = {
    name: name.trim().slice(0, 80),
    expiresAt: now + SESSION_MS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySession(value: string | undefined, now = Date.now()): AdminSession | null {
  if (!value || !secret()) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra || !constantTimeEqual(signature, sign(payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AdminSession;
    if (!parsed.name || !parsed.nonce || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= now) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function sessionFromRequest(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const value = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1);
  return verifySession(value ? decodeURIComponent(value) : undefined);
}

export function sessionCookie(value: string, maxAgeSeconds = SESSION_MS / 1000) {
  return [
    `${ADMIN_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    process.env.NODE_ENV === "production" ? "Secure" : "",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].filter(Boolean).join("; ");
}

export function clearSessionCookie() {
  return sessionCookie("", 0);
}

export function validMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin]);
  if (process.env.APP_ORIGIN) allowed.add(process.env.APP_ORIGIN.replace(/\/$/, ""));
  return allowed.has(origin.replace(/\/$/, ""));
}

export function isJsonRequest(request: Request) {
  return request.headers.get("content-type")?.toLowerCase().startsWith("application/json") ?? false;
}

export async function readJsonWithLimit(request: Request, limit: number) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > limit) throw new Error("body_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limit) throw new Error("body_too_large");
  return JSON.parse(text) as unknown;
}
