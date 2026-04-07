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
- 返回 JSON 对象，不要输出 Markdown 代码块，不要输出额外前言。
- \`fitReasons\` 保持 2 到 3 条，\`tradeoffs\` 保持 1 到 2 条，全部用中文短句。
- \`picks\` 里的两家不能重复。

固定输出 JSON 结构：
{
  "parsedRequestSummary": "1 句，概括你理解到的需求",
  "explanation": "1 句，说明为什么这次是这两家",
  "comparisonNote": "1 句，区分两家分别更适合什么",
  "tradeoffNote": "1 句，提醒这次推荐的取舍",
  "picks": [
    {
      "id": "店铺 id",
      "fitReasons": ["理由 1", "理由 2"],
      "tradeoffs": ["取舍 1"]
    },
    {
      "id": "店铺 id",
      "fitReasons": ["理由 1", "理由 2"],
      "tradeoffs": ["取舍 1"]
    }
  ]
}
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
请从列表里选出最适合当前需求的 2 家，并严格返回约定 JSON。
`.trim();
}
