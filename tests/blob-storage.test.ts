import { describe, expect, it } from "vitest";

import { cafes } from "../lib/cafes";
import { createDefaultOverlay, getPublicCoffeeSnapshot, publishDraft, rollbackRelease, validateOverlayForPublish } from "../lib/data/service";
import { MemoryJsonStorage } from "../lib/data/storage";

function publishable(editor = "tester") {
  const overlay = createDefaultOverlay(editor);
  overlay.note = "完整核验后发布";
  return overlay;
}

describe("Blob release transaction", () => {
  it("writes an immutable release then a published pointer", async () => {
    const storage = new MemoryJsonStorage();
    const result = await publishDraft(publishable(), "tester", null, storage);
    expect(result.release.kind).toBe("publish");
    expect(result.releasePath).toMatch(/^coffee-data\/releases\//);
    const snapshot = await getPublicCoffeeSnapshot(storage);
    expect(snapshot.version).toBe(result.release.releaseId);
    expect(snapshot.source).toBe("blob");
  });

  it("rejects concurrent pointer updates through ETag", async () => {
    const storage = new MemoryJsonStorage();
    const first = await publishDraft(publishable(), "tester", null, storage);
    await expect(publishDraft(publishable(), "tester", "stale-etag", storage)).rejects.toThrow("etag_conflict");
    expect((await getPublicCoffeeSnapshot(storage)).version).toBe(first.release.releaseId);
  });

  it("creates a new rollback release without rewriting history", async () => {
    const storage = new MemoryJsonStorage();
    const first = await publishDraft(publishable(), "tester", null, storage);
    const modified = publishable();
    modified.patches["standing-room"] = {
      ...cafes[0],
      summary: "这是第二个发布版本里的新摘要，具有完整证据记录。",
    };
    const second = await publishDraft(modified, "tester", first.pointerEtag, storage);
    const rollback = await rollbackRelease(first.releasePath, "tester", second.pointerEtag, storage);
    expect(rollback.release.kind).toBe("rollback");
    expect(rollback.release.releaseId).not.toBe(first.release.releaseId);
    expect((await storage.list("coffee-data/releases/")).length).toBe(3);
    expect((await getPublicCoffeeSnapshot(storage)).version).toBe(rollback.release.releaseId);
  });

  it("prevents physical deletion of a previously published addition", async () => {
    const storage = new MemoryJsonStorage();
    const withAddition = publishable();
    const added = { ...structuredClone(cafes[0]), id: "published-new-cafe", name: "已发布新店" };
    withAddition.additions.push(added);
    const first = await publishDraft(withAddition, "tester", null, storage);
    const removed = publishable();
    expect(() => validateOverlayForPublish(removed, first.pointer.publishedCafeIds)).toThrow("published_addition_cannot_be_deleted");
  });

  it("requires field-level evidence for changed facts", () => {
    const overlay = publishable();
    overlay.patches["standing-room"] = {
      sourceLabel: "现场观察",
      verifiedAt: "2026-08-12",
      verifiedBy: "tester",
      weekdayHours: "8:00-18:00",
    };
    expect(() => validateOverlayForPublish(overlay)).toThrow("field_evidence_required:standing-room:hours");
  });
});
