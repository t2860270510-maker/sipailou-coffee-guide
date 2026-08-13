import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getPublicCoffeeSnapshot } from "../../../lib/data/service";
import { getCafeDestination, type WalkingDistanceMap } from "../../../lib/location";
import type { Cafe } from "../../../lib/types";
import { recordMetric } from "../../../lib/metrics";

export const runtime = "nodejs";

const AMAP_BASE_URL = "https://restapi.amap.com";
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5_000;

const requestSchema = z.object({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  coordinateSystem: z.enum(["gps", "amap"]).optional().default("gps"),
});

type AmapResponse = { status?: string; locations?: string; route?: { paths?: Array<{ distance?: string; duration?: string }> } };
type DistanceResult = { distances: WalkingDistanceMap; failedCafeIds: string[] };
type CacheEntry = DistanceResult & { expiresAt: number };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<DistanceResult>>();

function apiError(status: number, code: string, message: string, requestId: string) {
  const response = NextResponse.json({ error: { code, message, requestId } }, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function bucketKey(dataVersion: string, longitude: number, latitude: number) {
  return `${dataVersion}:${longitude.toFixed(4)},${latitude.toFixed(4)}`;
}

function amapUrl(path: string, key: string, params: Record<string, string>) {
  const url = new URL(path, AMAP_BASE_URL);
  url.searchParams.set("key", key);
  url.searchParams.set("output", "JSON");
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url;
}

async function amapFetch(url: URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as AmapResponse | null;
    if (!response.ok || payload?.status !== "1") throw new Error("amap_unavailable");
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function convertCoordinate(key: string, longitude: number, latitude: number, system: "gps" | "amap") {
  if (system === "amap") return { longitude, latitude };
  const payload = await amapFetch(
    amapUrl("/v3/assistant/coordinate/convert", key, { locations: `${longitude},${latitude}`, coordsys: "gps" }),
  );
  const [convertedLongitude, convertedLatitude] = (payload.locations?.split(";")[0] ?? "").split(",").map(Number);
  return Number.isFinite(convertedLongitude) && Number.isFinite(convertedLatitude)
    ? { longitude: convertedLongitude, latitude: convertedLatitude }
    : { longitude, latitude };
}

async function oneDistance(key: string, origin: { longitude: number; latitude: number }, cafe: Cafe) {
  const destination = getCafeDestination(cafe);
  const payload = await amapFetch(
    amapUrl("/v3/direction/walking", key, {
      origin: `${origin.longitude},${origin.latitude}`,
      destination: `${destination.longitude},${destination.latitude}`,
    }),
  );
  const path = payload.route?.paths?.[0];
  const distanceM = Number(path?.distance);
  const durationSeconds = Number(path?.duration);
  if (!Number.isFinite(distanceM) || !Number.isFinite(durationSeconds)) throw new Error("amap_empty_route");
  return { distanceM: Math.round(distanceM), durationMin: Math.max(1, Math.ceil(durationSeconds / 60)), source: "amap_walking" as const };
}

async function withConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await task(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function calculate(key: string, origin: { longitude: number; latitude: number }, activeCafes: Cafe[]) {
  const settled = await withConcurrency(activeCafes, 4, (cafe) => oneDistance(key, origin, cafe));
  const distances: WalkingDistanceMap = {};
  const failedCafeIds: string[] = [];
  settled.forEach((result, index) => {
    const cafeId = activeCafes[index].id;
    if (result.status === "fulfilled") distances[cafeId] = result.value;
    else failedCafeIds.push(cafeId);
  });
  return { distances, failedCafeIds };
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return apiError(415, "UNSUPPORTED_MEDIA_TYPE", "请求必须使用 JSON 格式。", requestId);
  }
  const key = process.env.AMAP_WEB_KEY?.trim();
  if (!key) return apiError(503, "DISTANCE_NOT_CONFIGURED", "当前位置距离暂不可用，已保留校门距离。", requestId);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "INVALID_LOCATION", "定位坐标格式不正确。", requestId);
  const snapshot = await getPublicCoffeeSnapshot();

  const origin = await convertCoordinate(key, parsed.data.longitude, parsed.data.latitude, parsed.data.coordinateSystem).catch(() => ({
    longitude: parsed.data.longitude,
    latitude: parsed.data.latitude,
  }));
  const cacheKey = bucketKey(snapshot.version, origin.longitude, origin.latitude);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ ...cached, cached: true, dataVersion: snapshot.version }, { headers: { "Cache-Control": "private, max-age=60" } });
  }
  cache.delete(cacheKey);

  let pending = inFlight.get(cacheKey);
  if (!pending) {
    pending = calculate(key, origin, snapshot.cafes).finally(() => inFlight.delete(cacheKey));
    inFlight.set(cacheKey, pending);
  }
  const result = await pending;
  if (!Object.keys(result.distances).length) {
    recordMetric("location_result", { success: false, cafeCount: snapshot.cafes.length });
    return apiError(502, "DISTANCE_UNAVAILABLE", "高德步行距离暂不可用，已保留校门距离。", requestId);
  }
  cache.set(cacheKey, { ...result, expiresAt: Date.now() + CACHE_TTL_MS });
  recordMetric("location_result", { success: true, resolvedCafeCount: Object.keys(result.distances).length, failedCafeCount: result.failedCafeIds.length, cached: false });
  return NextResponse.json({ ...result, cached: false, dataVersion: snapshot.version }, { headers: { "Cache-Control": "private, max-age=60" } });
}
