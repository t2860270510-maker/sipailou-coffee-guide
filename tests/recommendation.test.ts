import { describe, expect, it } from "vitest";

import { cafes } from "../lib/cafes";
import { getCafeHoursState } from "../lib/hours";
import { buildRecommendation, cafeMatchesGroup, parseRecommendationQuery } from "../lib/recommendation";

const afternoon = new Date("2026-08-12T06:00:00.000Z"); // 14:00 Asia/Shanghai

const scenarios: Array<[string, [string, string]]> = [
  ["明早第一节前想顺路带一杯，别太贵", ["standing-room", "cafe-mo"]],
  ["下午想坐一会写东西，最好安静一点", ["katherine-starbucks", "disc-coffee"]],
  ["想和朋友碰面聊聊天，离学校近一点", ["disc-coffee", "joymean"]],
  ["预算低，想喝咖啡", ["standing-room", "cafe-mo"]],
  ["一定要插座，想写论文", ["katherine-starbucks", "disc-coffee"]],
  ["南门最近的咖啡", ["standing-room", "cafe-mo"]],
  ["东门附近聊天", ["disc-coffee", "joymean"]],
  ["想喝精品手冲", ["joymean", "clip-coffee"]],
  ["想买了带走", ["standing-room", "cafe-mo"]],
  ["早八前喝一杯", ["standing-room", "manner"]],
  ["预算充足想喝特调", ["umber", "joymean"]],
  ["下午安静办公", ["katherine-starbucks", "disc-coffee"]],
  ["想久坐", ["katherine-starbucks", "disc-coffee"]],
  ["赶时间快速买一杯", ["standing-room", "cafe-mo"]],
  ["和朋友约会有氛围", ["disc-coffee", "joymean"]],
  ["便宜又近", ["standing-room", "cafe-mo"]],
  ["东门精品咖啡", ["disc-coffee", "joymean"]],
  ["南门早上带走", ["standing-room", "cafe-mo"]],
  ["有插座更好", ["katherine-starbucks", "disc-coffee"]],
  ["不介意走远想喝好豆子", ["joymean", "clip-coffee"]],
  ["现在营业吗", ["disc-coffee", "standing-room"]],
  ["快关门了吗", ["disc-coffee", "standing-room"]],
  ["Cafe Mo适合吗", ["disc-coffee", "standing-room"]],
  ["坐一下午写论文", ["katherine-starbucks", "disc-coffee"]],
  ["低预算聊天", ["disc-coffee", "joymean"]],
  ["安静但预算低", ["standing-room", "manner"]],
  ["外带且东门近", ["manner", "standing-room"]],
  ["学习写作插座", ["katherine-starbucks", "disc-coffee"]],
];

describe("deterministic recommendation regression", () => {
  it.each(scenarios)("locks Top2 for %s", (query, expected) => {
    const result = buildRecommendation({ cafes, query, now: afternoon });
    expect(result.selectedCafeIds).toEqual(expected);
    expect(result.topPicks).toHaveLength(2);
    expect(result.topPicks.every((pick) => pick.fitReasons.length > 0)).toBe(true);
    for (const id of result.selectedCafeIds) expect(result.explanation).toContain(cafes.find((cafe) => cafe.id === id)?.name);
  });

  it("inherits the previous intent when budget is lowered", () => {
    const history = [
      { role: "user" as const, content: "下午想坐一会写东西，最好安静一点" },
      { role: "assistant" as const, content: "上一轮完整推荐" },
    ];
    const result = buildRecommendation({ cafes, query: "预算再低一点", history, now: afternoon });
    expect(result.parsedRequest.scene).toBe("study");
    expect(result.parsedRequest.quietNeed).toBe("high");
    expect(result.parsedRequest.budget).toBe("low");
  });

  it("lets the latest explicit condition override history", () => {
    const parsed = parseRecommendationQuery("换成更适合久坐的", [
      { role: "user", content: "赶时间，买了就走" },
      { role: "assistant", content: "上一轮完整推荐" },
    ]);
    expect(parsed.stayIntent).toBe("long");
    expect(parsed.scene).toBe("study");
  });

  it("does not pad hard-filtered results with ineligible cafes", () => {
    const onlyNoSockets = cafes.map((cafe) => ({ ...cafe, socketLevel: "none" as const }));
    const result = buildRecommendation({ cafes: onlyNoSockets, query: "必须有插座", now: afternoon });
    expect(result.topPicks).toHaveLength(0);
    expect(result.relaxationAdvice).toContain("必须有插座");
    expect(result.ranked.every((pick) => pick.hardExclusions.includes("没有可用插座"))).toBe(true);
  });

  it("excludes inactive cafes before scoring", () => {
    const modified = cafes.map((cafe) => (cafe.id === "standing-room" ? { ...cafe, status: "inactive" as const } : cafe));
    const result = buildRecommendation({ cafes: modified, query: "早八便宜带走", now: afternoon });
    expect(result.selectedCafeIds).not.toContain("standing-room");
  });

  it("uses live walking distances only as a ranking signal", () => {
    const result = buildRecommendation({
      cafes,
      query: "想和朋友聊天，近一点",
      now: afternoon,
      location: {
        longitude: 118.79,
        latitude: 32.05,
        distances: { joymean: { distanceM: 20, durationMin: 1 }, "disc-coffee": { distanceM: 900, durationMin: 14 } },
      },
    });
    expect(result.selectedCafeIds[0]).toBe("joymean");
  });

  it("computes open and closing-soon states from structured hours", () => {
    const standing = cafes.find((cafe) => cafe.id === "standing-room")!;
    expect(getCafeHoursState(standing, afternoon).state).toBe("open");
    expect(getCafeHoursState(standing, new Date("2026-08-12T07:30:00.000Z")).state).toBe("closing_soon");
    expect(getCafeHoursState(standing, new Date("2026-08-12T10:00:00.000Z")).state).toBe("closed");
  });

  it("keeps guide categories available without a map", () => {
    expect(cafes.filter((cafe) => cafeMatchesGroup(cafe, "study")).map((cafe) => cafe.id)).toContain("katherine-starbucks");
    expect(cafes.filter((cafe) => cafeMatchesGroup(cafe, "specialty")).map((cafe) => cafe.id)).toContain("umber");
  });
});
