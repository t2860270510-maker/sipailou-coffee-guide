import { NextResponse } from "next/server";

import { adminAuthConfigured } from "../../../lib/admin-auth";
import { getPublicCoffeeSnapshot } from "../../../lib/data/service";
import { VercelJsonStorage } from "../../../lib/data/storage";
import { isDeepSeekConfigured } from "../../../lib/deepseek";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getPublicCoffeeSnapshot();
  const dataBlobConfigured = new VercelJsonStorage().configured;
  const health = {
    status: snapshot.cafes.length >= 2 ? "ok" : "degraded",
    services: {
      modelConfigured: isDeepSeekConfigured(),
      amapClientConfigured: Boolean(process.env.NEXT_PUBLIC_AMAP_JS_KEY),
      amapServerConfigured: Boolean(process.env.AMAP_WEB_KEY),
      dataBlobConfigured,
      mediaBlobConfigured: Boolean(process.env.COFFEE_MEDIA_BLOB_READ_WRITE_TOKEN || process.env.COFFEE_MEDIA_BLOB_STORE_ID),
      adminConfigured: adminAuthConfigured(),
    },
    data: {
      version: snapshot.version,
      source: snapshot.source,
      activeCafeCount: snapshot.cafes.length,
      usingStaticBaseline: snapshot.source === "static",
      degraded: snapshot.degraded,
      compatibilityWarnings: snapshot.warnings,
    },
  };
  return NextResponse.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
