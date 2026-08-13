import { randomUUID } from "node:crypto";

import { cafes as staticCafes } from "../cafes";
import { DEFAULT_PROMPT_STYLE } from "../deepseek-prompts";
import type { Cafe, CoffeeDataSnapshot, CoffeeOverlayV1, CoffeeReleaseV1, PublishedPointerV1 } from "../types";
import { cafeSchema, overlaySchema, pointerSchema, releaseSchema } from "./schema";
import { VercelJsonStorage, type JsonStorage } from "./storage";

export const DRAFT_PATH = "coffee-data/draft.json";
export const POINTER_PATH = "coffee-data/published.json";
export const RELEASE_PREFIX = "coffee-data/releases/";
export const STATIC_VERSION = "static-v1";
const PUBLIC_CACHE_MS = 60_000;

let cachedPublic: { expiresAt: number; snapshot: CoffeeDataSnapshot } | null = null;

export function createDefaultOverlay(editor = "管理员"): CoffeeOverlayV1 {
  return {
    schemaVersion: 1,
    baseVersion: STATIC_VERSION,
    updatedAt: new Date().toISOString(),
    updatedBy: editor,
    note: "从静态基线创建草稿",
    promptStyle: DEFAULT_PROMPT_STYLE,
    patches: {},
    additions: [],
  };
}

function overlayFields(input: CoffeeOverlayV1 | CoffeeReleaseV1): CoffeeOverlayV1 {
  return {
    schemaVersion: input.schemaVersion,
    baseVersion: input.baseVersion,
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
    note: input.note,
    promptStyle: input.promptStyle,
    patches: input.patches,
    additions: input.additions,
  };
}

function mergeCafe(base: Cafe, patch: Partial<Cafe>): Cafe {
  return {
    ...base,
    ...patch,
    priceRange: patch.priceRange ?? base.priceRange,
    quietByPeriod: patch.quietByPeriod ?? base.quietByPeriod,
    structuredHours: patch.structuredHours ?? base.structuredHours,
    fieldEvidence: patch.fieldEvidence ? { ...base.fieldEvidence, ...patch.fieldEvidence } : base.fieldEvidence,
  };
}

export function applyOverlay(overlay: CoffeeOverlayV1) {
  const parsed = overlaySchema.parse(overlayFields(overlay));
  const baselineIds = new Set(staticCafes.map((cafe) => cafe.id));
  for (const patchId of Object.keys(parsed.patches)) {
    if (!baselineIds.has(patchId)) throw new Error(`unknown_baseline_cafe:${patchId}`);
  }
  for (const addition of parsed.additions) {
    if (baselineIds.has(addition.id)) throw new Error(`addition_conflicts_with_baseline:${addition.id}`);
  }
  const merged = staticCafes.map((cafe) => mergeCafe(cafe, parsed.patches[cafe.id] ?? {}));
  const all = [...merged, ...parsed.additions].map((cafe) => cafeSchema.parse(cafe));
  if (all.length > 100) throw new Error("too_many_cafes");
  if (new Set(all.map((cafe) => cafe.id)).size !== all.length) throw new Error("duplicate_cafe_id");
  if (all.filter((cafe) => cafe.status === "active").length < 2) throw new Error("at_least_two_active_cafes_required");
  return all;
}

const evidenceGroups: Array<{ keys: Array<keyof Cafe>; evidence: keyof Cafe["fieldEvidence"] }> = [
  { keys: ["structuredHours", "temporaryHoursNotice", "weekdayHours", "weekendHours"], evidence: "hours" },
  { keys: ["priceRange", "priceLevel"], evidence: "price" },
  { keys: ["locationText", "address", "nearestGate", "amapPoiId", "longitude", "latitude", "entranceLongitude", "entranceLatitude", "amapAddress"], evidence: "location" },
  { keys: ["quietScore", "quietByPeriod", "seatLevel", "socketLevel", "wifi", "restroom", "takeout", "stayIntent", "mainScene", "tags", "summary", "notes"], evidence: "experience" },
  { keys: ["recommendedItems", "dietaryOptions"], evidence: "menu" },
  { keys: ["coverImage", "imageGallery"], evidence: "images" },
];

export function validateOverlayForPublish(overlay: CoffeeOverlayV1, publishedCafeIds: string[] = []) {
  const parsed = overlaySchema.parse(overlayFields(overlay));
  for (const [cafeId, patch] of Object.entries(parsed.patches)) {
    if (!patch.sourceLabel || !patch.verifiedAt || !patch.verifiedBy) throw new Error(`change_evidence_required:${cafeId}`);
    for (const group of evidenceGroups) {
      if (group.keys.some((key) => key in patch) && !patch.fieldEvidence?.[group.evidence]) {
        throw new Error(`field_evidence_required:${cafeId}:${group.evidence}`);
      }
    }
  }
  const additions = new Set(parsed.additions.map((cafe) => cafe.id));
  const publishedAdditions = publishedCafeIds.filter((id) => !staticCafes.some((cafe) => cafe.id === id));
  for (const id of publishedAdditions) {
    if (!additions.has(id)) throw new Error(`published_addition_cannot_be_deleted:${id}`);
  }
  return { overlay: parsed, cafes: applyOverlay(parsed) };
}

function staticSnapshot(warning?: string): CoffeeDataSnapshot {
  return {
    version: STATIC_VERSION,
    source: "static",
    degraded: Boolean(warning),
    warnings: warning ? [warning] : [],
    cafes: staticCafes.filter((cafe) => cafe.status === "active"),
    allCafes: staticCafes,
  };
}

function parseStored<T>(text: string, parser: { parse(value: unknown): T }) {
  return parser.parse(JSON.parse(text) as unknown);
}

export async function getPublicCoffeeSnapshot(storage?: JsonStorage): Promise<CoffeeDataSnapshot> {
  const useDefaultStorage = storage === undefined;
  if (useDefaultStorage && cachedPublic && cachedPublic.expiresAt > Date.now()) return cachedPublic.snapshot;
  const adapter = storage ?? new VercelJsonStorage();
  if (!adapter.configured) return staticSnapshot("DATA_BLOB_NOT_CONFIGURED");
  let snapshot: CoffeeDataSnapshot;
  try {
    const pointerStored = await adapter.read(POINTER_PATH, true);
    if (!pointerStored) return staticSnapshot("PUBLISHED_POINTER_MISSING");
    const pointer = parseStored(pointerStored.text, pointerSchema);
    const releaseStored = await adapter.read(pointer.releasePath, true);
    if (!releaseStored) return staticSnapshot("PUBLISHED_RELEASE_MISSING");
    const release = parseStored(releaseStored.text, releaseSchema);
    const allCafes = applyOverlay(release);
    snapshot = {
      version: release.releaseId,
      source: "blob",
      degraded: false,
      warnings: [],
      cafes: allCafes.filter((cafe) => cafe.status === "active"),
      allCafes,
    };
  } catch {
    snapshot = staticSnapshot("PUBLISHED_DATA_INVALID");
  }
  if (useDefaultStorage) cachedPublic = { expiresAt: Date.now() + PUBLIC_CACHE_MS, snapshot };
  return snapshot;
}

export async function readDraft(storage: JsonStorage = new VercelJsonStorage(), editor = "管理员") {
  if (!storage.configured) return { overlay: createDefaultOverlay(editor), etag: null, configured: false };
  const stored = await storage.read(DRAFT_PATH, false);
  if (!stored) return { overlay: createDefaultOverlay(editor), etag: null, configured: true };
  return { overlay: parseStored(stored.text, overlaySchema), etag: stored.etag, configured: true };
}

export async function saveDraft(overlay: CoffeeOverlayV1, expectedEtag: string | null, storage: JsonStorage = new VercelJsonStorage()) {
  const parsed = overlaySchema.parse(overlay);
  applyOverlay(parsed);
  const current = await storage.read(DRAFT_PATH, false);
  if ((current?.etag ?? null) !== expectedEtag) throw new Error("etag_conflict");
  const saved = await storage.write(DRAFT_PATH, JSON.stringify(parsed), { ifMatch: current?.etag });
  return { overlay: parsed, etag: saved.etag };
}

async function readPointer(storage: JsonStorage) {
  const stored = await storage.read(POINTER_PATH, false);
  return stored ? { pointer: parseStored(stored.text, pointerSchema), etag: stored.etag } : { pointer: null, etag: null };
}

function releasePath(releaseId: string, publishedAt: string) {
  return `${RELEASE_PREFIX}${publishedAt.replace(/[:.]/g, "-")}-${releaseId}.json`;
}

export async function publishDraft(
  overlay: CoffeeOverlayV1,
  editor: string,
  expectedPointerEtag: string | null,
  storage: JsonStorage = new VercelJsonStorage(),
) {
  const current = await readPointer(storage);
  if (current.etag !== expectedPointerEtag) throw new Error("etag_conflict");
  const validated = validateOverlayForPublish(overlay, current.pointer?.publishedCafeIds ?? []);
  const publishedAt = new Date().toISOString();
  const releaseId = randomUUID();
  const release: CoffeeReleaseV1 = releaseSchema.parse({
    ...validated.overlay,
    updatedAt: publishedAt,
    updatedBy: editor,
    releaseId,
    publishedAt,
    publishedBy: editor,
    kind: "publish",
  });
  const path = releasePath(releaseId, publishedAt);
  await storage.write(path, JSON.stringify(release), { immutable: true });
  const pointer: PublishedPointerV1 = {
    schemaVersion: 1,
    releasePath: path,
    releaseId,
    publishedAt,
    publishedCafeIds: Array.from(new Set([...(current.pointer?.publishedCafeIds ?? []), ...validated.cafes.map((cafe) => cafe.id)])).sort(),
  };
  const savedPointer = await storage.write(POINTER_PATH, JSON.stringify(pointer), { ifMatch: current.etag ?? undefined });
  cachedPublic = null;
  return { release, releasePath: path, pointer, pointerEtag: savedPointer.etag };
}

export async function listReleases(storage: JsonStorage = new VercelJsonStorage()) {
  const entries = await storage.list(RELEASE_PREFIX);
  const versions = await Promise.all(entries.map(async (entry) => {
    try {
      const stored = await storage.read(entry.pathname, false);
      if (!stored) return null;
      return { release: parseStored(stored.text, releaseSchema), pathname: entry.pathname, etag: entry.etag };
    } catch {
      return null;
    }
  }));
  return versions.filter((item): item is NonNullable<typeof item> => Boolean(item)).sort((a, b) => b.release.publishedAt.localeCompare(a.release.publishedAt));
}

export async function rollbackRelease(
  targetPath: string,
  editor: string,
  expectedPointerEtag: string,
  storage: JsonStorage = new VercelJsonStorage(),
) {
  if (!targetPath.startsWith(RELEASE_PREFIX)) throw new Error("invalid_release_path");
  const targetStored = await storage.read(targetPath, false);
  if (!targetStored) throw new Error("release_not_found");
  const target = parseStored(targetStored.text, releaseSchema);
  const current = await readPointer(storage);
  if (!current.pointer || current.etag !== expectedPointerEtag) throw new Error("etag_conflict");
  validateOverlayForPublish(target, current.pointer.publishedCafeIds);
  const publishedAt = new Date().toISOString();
  const releaseId = randomUUID();
  const rollback: CoffeeReleaseV1 = releaseSchema.parse({
    ...target,
    updatedAt: publishedAt,
    updatedBy: editor,
    releaseId,
    publishedAt,
    publishedBy: editor,
    kind: "rollback",
    rolledBackFrom: current.pointer.releasePath,
  });
  const path = releasePath(releaseId, publishedAt);
  await storage.write(path, JSON.stringify(rollback), { immutable: true });
  const pointer: PublishedPointerV1 = {
    schemaVersion: 1,
    releasePath: path,
    releaseId,
    publishedAt,
    publishedCafeIds: current.pointer.publishedCafeIds,
  };
  const savedPointer = await storage.write(POINTER_PATH, JSON.stringify(pointer), { ifMatch: current.etag });
  const draft = await storage.read(DRAFT_PATH, false);
  const restoredDraft: CoffeeOverlayV1 = {
    schemaVersion: 1,
    baseVersion: target.baseVersion,
    updatedAt: publishedAt,
    updatedBy: editor,
    note: `从版本 ${target.releaseId} 回退并同步草稿`,
    promptStyle: target.promptStyle,
    patches: target.patches,
    additions: target.additions,
  };
  await storage.write(DRAFT_PATH, JSON.stringify(restoredDraft), { ifMatch: draft?.etag });
  cachedPublic = null;
  return { release: rollback, releasePath: path, pointer, pointerEtag: savedPointer.etag };
}

export async function getPublishedPointer(storage: JsonStorage = new VercelJsonStorage()) {
  return readPointer(storage);
}

export function clearCoffeeSnapshotCache() {
  cachedPublic = null;
}
