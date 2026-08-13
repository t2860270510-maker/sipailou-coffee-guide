import { afterEach, describe, expect, it } from "vitest";

import { GET as getConfig } from "../app/api/admin/config/route";
import { POST as login } from "../app/api/admin/login/route";

afterEach(() => { delete process.env.ADMIN_ACCESS_TOKEN; });

describe("admin API", () => {
  it("creates a signed HttpOnly Strict cookie and accepts it", async () => {
    process.env.ADMIN_ACCESS_TOKEN = "secret-token";
    const loginResponse = await login(new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ token: "secret-token", name: "核验人" }),
    }));
    expect(loginResponse.status).toBe(200);
    const cookie = loginResponse.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const configResponse = (await getConfig(new Request("http://localhost/api/admin/config", { headers: { cookie } })))!;
    expect(configResponse.status).toBe(200);
    expect(await configResponse.json()).toMatchObject({ editor: "核验人" });
  });

  it("rejects a tampered session cookie", async () => {
    process.env.ADMIN_ACCESS_TOKEN = "secret-token";
    const response = (await getConfig(new Request("http://localhost/api/admin/config", { headers: { cookie: "coffee_admin_session=bad.payload" } })))!;
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "ADMIN_UNAUTHORIZED" } });
  });
});
