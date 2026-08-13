import type { RecommendationResult } from "./types";

export const DEFAULT_PROMPT_STYLE = "像熟悉四牌楼周边的朋友，克制、具体、自然；四段以内，不写营销话术。";

export const FIXED_MODEL_GUARDRAILS = [
  "只能解释规则引擎已经选中的店铺，不能新增、替换或删除店铺。",
  "只能使用事实清单里的内容，不得推测营业时间、价格、距离、座位、插座、菜单或氛围。",
  "返回 JSON 对象，selectedCafeIds 必须与输入顺序完全一致，text 是完整中文推荐正文。",
  "正文必须明确点名每家入选店；不要提及未入选店铺。",
  "如果无法遵守，返回空 text，不要自行补充。",
];

export function buildExplanationPrompt(result: RecommendationResult, promptStyle = DEFAULT_PROMPT_STYLE) {
  const selected = result.topPicks.map((pick) => ({
    id: pick.cafe.id,
    name: pick.cafe.name,
    aliases: pick.cafe.aliases,
    facts: {
      location: pick.cafe.locationText,
      nearestGate: pick.cafe.nearestGate,
      staticWalkDistanceM: pick.cafe.walkDistanceM,
      staticWalkTimeMin: pick.cafe.walkTimeMin,
      weekdayHours: pick.cafe.weekdayHours,
      weekendHours: pick.cafe.weekendHours,
      priceRangeCny: pick.cafe.priceRange,
      priceLevel: pick.cafe.priceLevel,
      quietScore: pick.cafe.quietScore,
      socketLevel: pick.cafe.socketLevel,
      seatLevel: pick.cafe.seatLevel,
      takeout: pick.cafe.takeout,
      tags: pick.cafe.tags,
      items: pick.cafe.recommendedItems,
      summary: pick.cafe.summary,
      notes: pick.cafe.notes,
      verifiedAt: pick.cafe.verifiedAt,
    },
    ruleReasons: pick.fitReasons,
    ruleTradeoffs: pick.tradeoffs,
  }));

  return [
    "你是『四牌楼咖啡指北』的解释编辑。推荐选择已经由本地规则引擎完成。",
    "不可更改的规则：",
    ...FIXED_MODEL_GUARDRAILS.map((rule) => `- ${rule}`),
    `编辑语气：${promptStyle}`,
    `用户需求摘要：${result.parsedRequestSummary}`,
    `本地兜底正文：${result.explanation}`,
    `唯一允许引用的店铺事实：${JSON.stringify(selected)}`,
    '只输出形如 {"selectedCafeIds":["id1","id2"],"text":"完整正文"} 的 JSON。',
  ].join("\n");
}
