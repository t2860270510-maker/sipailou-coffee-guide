import { cafes } from "./cafes";

function formatCafeContext(index: number) {
  const cafe = cafes[index];
  return [
    `${cafe.id} | ${cafe.name}`,
    `gate=${cafe.nearestGate}; walk=${cafe.walkTimeMin}min/${cafe.walkDistanceM}m; weekday=${cafe.weekdayHours}; weekend=${cafe.weekendHours}`,
    `scene=${cafe.mainScene}; early=${cafe.earlyFriendly}; price=${cafe.priceLevel}; quiet=${cafe.quietScore}; socket=${cafe.socketLevel}`,
    `tags=${cafe.tags.join(", ")}; items=${cafe.recommendedItems.join(", ")}`,
    `summary=${cafe.summary}`,
    `note=${cafe.notes}`,
  ].join("\n");
}

export const MINIMAX_SYSTEM_PROMPT = `
你是「四牌楼咖啡指北」里的对话助手。你要根据用户当前需求，在提供给你的 8 家店里亲自选出最适合的 2 家，并像一个克制、可信的 chatbot 一样解释原因。

硬性规则：
- 只能推荐 2 家，而且必须从提供的店铺列表里选择。
- 不能编造任何营业时间、距离、价格、插座、安静程度或氛围事实。
- 优先根据用户需求做判断，不要套模板，不要把所有店说成“都可以”。
- 直接输出自然中文，不要输出 JSON，不要输出 Markdown 表格，不要输出代码块。
- 第一段就直接点名这次最推荐的 2 家。
- 整体控制在 4 段以内，像聊天回复一样，简洁但要说清楚差别。
- 如果用户在意插座，除了凯瑟琳星巴克，不要主动把别家说成插座友好。
`.trim();

export function buildCafeContextBlock() {
  return cafes.map((_, index) => [`[Cafe ${index + 1}]`, formatCafeContext(index)].join("\n")).join("\n\n");
}

export function buildRecommendationPrompt(rawQuery: string) {
  return `
[User Query]
${rawQuery}

[Available Cafes]
${buildCafeContextBlock()}

[Output Reminder]
请直接流式输出一段适合出现在聊天框里的自然中文回复。
`.trim();
}
