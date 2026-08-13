import { afterEach, describe, expect, it } from "vitest";

import { ADMIN_COOKIE, createSession, credentialsAreValid, sessionFromRequest, validMutationOrigin, verifySession } from "../lib/admin-auth";

afterEach(() => { delete process.env.ADMIN_ACCESS_TOKEN; delete process.env.APP_ORIGIN; });

describe("admin authentication and CSRF controls", () => {
  it("signs a 12 hour HttpOnly session and detects tampering", () => {
    process.env.ADMIN_ACCESS_TOKEN = "top-secret";
    const now = Date.now();
    const session = createSession("核验人", now);
    expect(verifySession(session, now + 1000)?.name).toBe("核验人");
    expect(verifySession(`${session}x`, now + 1000)).toBeNull();
    expect(verifySession(session, now + 12 * 60 * 60 * 1000 + 1)).toBeNull();
  });

  it("invalidates existing cookies after token rotation", () => {
    process.env.ADMIN_ACCESS_TOKEN = "first-secret";
    const session = createSession("tester");
    process.env.ADMIN_ACCESS_TOKEN = "second-secret";
    expect(verifySession(session)).toBeNull();
  });

  it("uses constant-time credential comparison semantics", () => {
    process.env.ADMIN_ACCESS_TOKEN = "top-secret";
    expect(credentialsAreValid("top-secret")).toBe(true);
    expect(credentialsAreValid("top-secret<script>")).toBe(false);
  });

  it("reads only the signed cookie and rejects cross-site mutations", () => {
    process.env.ADMIN_ACCESS_TOKEN = "top-secret";
    const session = createSession("tester");
    const allowed = new Request("https://coffee.example/api/admin/draft", { headers: { origin: "https://coffee.example", cookie: `${ADMIN_COOKIE}=${encodeURIComponent(session)}` } });
    const denied = new Request("https://coffee.example/api/admin/draft", { headers: { origin: "https://evil.example", cookie: `${ADMIN_COOKIE}=${encodeURIComponent(session)}` } });
    expect(sessionFromRequest(allowed)?.name).toBe("tester");
    expect(validMutationOrigin(allowed)).toBe(true);
    expect(validMutationOrigin(denied)).toBe(false);
  });
});
