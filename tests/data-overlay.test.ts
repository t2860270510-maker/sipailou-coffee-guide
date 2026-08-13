import { describe, expect, it } from "vitest";

import { cafes } from "../lib/cafes";
import { applyOverlay, createDefaultOverlay, getPublicCoffeeSnapshot, POINTER_PATH } from "../lib/data/service";
import { MemoryJsonStorage } from "../lib/data/storage";
import { safeHttpUrl } from "../lib/data/schema";

describe("CoffeeOverlay v1", () => {
  it("keeps the static baseline immutable while applying field patches", () => {
    const original = cafes[0].summary;
    const overlay = createDefaultOverlay("tester");
    overlay.patches[cafes[0].id] = { summary: "这是经过来源核验后的新摘要，公开数据只读取叠加结果。" };
    const merged = applyOverlay(overlay);
    expect(merged[0].summary).not.toBe(original);
    expect(cafes[0].summary).toBe(original);
  });

  it("removes non-active cafes from the public snapshot", async () => {
    const storage = new MemoryJsonStorage();
    const overlay = createDefaultOverlay("tester");
    overlay.patches["standing-room"] = { status: "inactive" };
    const release = { ...overlay, releaseId: "release-1", publishedAt: new Date().toISOString(), publishedBy: "tester", kind: "publish" as const };
    const path = "coffee-data/releases/release-1.json";
    storage.seed(path, release);
    storage.seed(POINTER_PATH, { schemaVersion: 1, releasePath: path, releaseId: "release-1", publishedAt: release.publishedAt, publishedCafeIds: cafes.map((cafe) => cafe.id) });
    const snapshot = await getPublicCoffeeSnapshot(storage);
    expect(snapshot.source).toBe("blob");
    expect(snapshot.cafes.map((cafe) => cafe.id)).not.toContain("standing-room");
  });

  it.each([
    ["missing", new MemoryJsonStorage()],
    ["corrupt", (() => { const storage = new MemoryJsonStorage(); storage.seed(POINTER_PATH, "not-json"); return storage; })()],
    ["old schema", (() => { const storage = new MemoryJsonStorage(); storage.seed(POINTER_PATH, { schemaVersion: 0 }); return storage; })()],
  ])("falls back to static for %s Blob data", async (_name, storage) => {
    const snapshot = await getPublicCoffeeSnapshot(storage);
    expect(snapshot.source).toBe("static");
    expect(snapshot.degraded).toBe(true);
    expect(snapshot.cafes).toHaveLength(8);
  });

  it("rejects dangerous source protocols", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeHttpUrl("https://example.com/source")).toBe("https://example.com/source");
  });
});
