import { NextResponse } from "next/server";
import { z } from "zod";

import { cafes } from "../../../lib/cafes";
import { getCafeDestination, type WalkingDistanceMap } from "../../../lib/location";

const AMAP_BASE_URL = "https://restapi.amap.com";
const DISTANCE_CACHE_TTL_MS = 5 * 60 * 1000;
const AMAP_REQUEST_TIMEOUT_MS = 5000;
const AMAP_REQUEST_SPACING_MS = 450;

const requestSchema = z.object({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  coordinateSystem: z.enum(["gps", "amap"]).optional().default("gps"),
});

type AmapBaseResponse = {
  status?: string;
  info?: string;
  infocode?: string;
};

type AmapWalkingResponse = AmapBaseResponse & {
  route?: {
    paths?: Array<{
      distance?: string;
      duration?: string;
    }>;
  };
};

type AmapCoordinateConvertResponse = AmapBaseResponse & {
  locations?: string;
};

type DistanceCacheEntry = {
  expiresAt: number;
  distances: WalkingDistanceMap;
  failedCafeIds: string[];
};

const distanceCache = new Map<string, DistanceCacheEntry>();

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildAmapUrl(path: string, apiKey: string, params: Record<string, string>) {
  const url = new URL(`${AMAP_BASE_URL}${path}`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("output", "JSON");

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url;
}

async function fetchAmapJson<T extends AmapBaseResponse>(url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AMAP_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = (await response.json().catch(() => ({}))) as T;

    if (!response.ok || payload.status !== "1") {
      throw new Error(payload.infocode || payload.info || "amap_request_failed");
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function parseConvertedCoordinate(locations: string | undefined) {
  const firstLocation = locations?.split(";")[0];
  const [longitude, latitude] = firstLocation?.split(",").map(Number) ?? [];

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }

  return { longitude, latitude };
}

async function toAmapCoordinate({
  apiKey,
  longitude,
  latitude,
  coordinateSystem,
}: {
  apiKey: string;
  longitude: number;
  latitude: number;
  coordinateSystem: "gps" | "amap";
}) {
  if (coordinateSystem === "amap") {
    return { longitude, latitude };
  }

  const url = buildAmapUrl("/v3/assistant/coordinate/convert", apiKey, {
    locations: `${longitude},${latitude}`,
    coordsys: "gps",
  });

  const payload = await fetchAmapJson<AmapCoordinateConvertResponse>(url);
  return parseConvertedCoordinate(payload.locations) ?? { longitude, latitude };
}

function cacheKeyFor(longitude: number, latitude: number) {
  return `${longitude.toFixed(5)},${latitude.toFixed(5)}`;
}

function getCachedDistances(longitude: number, latitude: number) {
  const cacheKey = cacheKeyFor(longitude, latitude);
  const cached = distanceCache.get(cacheKey);

  if (!cached || cached.expiresAt < Date.now()) {
    distanceCache.delete(cacheKey);
    return null;
  }

  return cached;
}

function setCachedDistances(longitude: number, latitude: number, entry: Omit<DistanceCacheEntry, "expiresAt">) {
  distanceCache.set(cacheKeyFor(longitude, latitude), {
    ...entry,
    expiresAt: Date.now() + DISTANCE_CACHE_TTL_MS,
  });
}

async function getWalkingDistance({
  apiKey,
  origin,
  destination,
}: {
  apiKey: string;
  origin: { longitude: number; latitude: number };
  destination: { longitude: number; latitude: number };
}) {
  const url = buildAmapUrl("/v3/direction/walking", apiKey, {
    origin: `${origin.longitude},${origin.latitude}`,
    destination: `${destination.longitude},${destination.latitude}`,
  });

  const payload = await fetchAmapJson<AmapWalkingResponse>(url);
  const firstPath = payload.route?.paths?.[0];
  const distanceM = Number(firstPath?.distance);
  const durationSeconds = Number(firstPath?.duration);

  if (!Number.isFinite(distanceM) || !Number.isFinite(durationSeconds)) {
    throw new Error("amap_empty_route");
  }

  return {
    distanceM: Math.round(distanceM),
    durationMin: Math.max(1, Math.ceil(durationSeconds / 60)),
    source: "amap_walking" as const,
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.AMAP_WEB_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { message: "当前位置步行距离暂时不可用，先显示校门距离。" },
      { status: 503 },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { message: "定位坐标格式不正确。" },
      { status: 400 },
    );
  }

  const userCoordinate = parsed.data;
  const origin = await toAmapCoordinate({
    apiKey,
    longitude: userCoordinate.longitude,
    latitude: userCoordinate.latitude,
    coordinateSystem: userCoordinate.coordinateSystem,
  }).catch(() => ({
    longitude: userCoordinate.longitude,
    latitude: userCoordinate.latitude,
  }));

  const cached = getCachedDistances(origin.longitude, origin.latitude);
  if (cached) {
    return NextResponse.json({
      distances: cached.distances,
      failedCafeIds: cached.failedCafeIds,
      cached: true,
      message: cached.failedCafeIds.length ? "部分店铺步行距离暂时不可用，已保留校门距离。" : undefined,
    });
  }

  const distances: WalkingDistanceMap = {};
  const failedCafeIds: string[] = [];

  for (const [index, cafe] of cafes.entries()) {
    if (index > 0) {
      await sleep(AMAP_REQUEST_SPACING_MS);
    }

    try {
      distances[cafe.id] = await getWalkingDistance({
        apiKey,
        origin,
        destination: getCafeDestination(cafe),
      });
    } catch {
      failedCafeIds.push(cafe.id);
    }
  }

  if (Object.keys(distances).length === 0) {
    return NextResponse.json(
      { message: "高德步行距离暂时不可用，先显示校门距离。" },
      { status: 502 },
    );
  }

  setCachedDistances(origin.longitude, origin.latitude, { distances, failedCafeIds });

  return NextResponse.json({
    distances,
    failedCafeIds,
    cached: false,
    message: failedCafeIds.length ? "部分店铺步行距离暂时不可用，已保留校门距离。" : undefined,
  });
}
