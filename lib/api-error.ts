import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export function apiError(status: number, code: string, message: string, requestId = randomUUID()) {
  const response = NextResponse.json({ error: { code, message, requestId } }, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function noStoreJson(data: unknown, init?: ResponseInit) {
  const response = NextResponse.json(data, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
