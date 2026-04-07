import { cafes } from "./cafes";
import type { RecommendationResult } from "./types";

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
你是「四牌楼咖啡指北」里的对话助手。用户已经有了 2 家经过本地事实筛选的候选店，你只负责把这 2 家用自然、简短、像产品里的回答那样说清楚。

硬性规则：
- 只能推荐 2 家，而且只能使用提供给你的这 2 家店信息，不要引入第三家。
- 不能编造任何营业时间、距离、价格、插座、安静程度或氛围事实。
- 输出必须是 3 行纯文本，每行都以固定前缀开头。
- 不要输出 JSON，不要输出 Markdown，不要输出额外前言。

固定输出格式：
概述：1 句，直接告诉用户这次为什么是这两家。
对比：1 句，清楚区分两家分别更适合什么。
提醒：1 句，提醒这次推荐仍然有什么取舍。
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
请只围绕其中 2 家给出简短推荐，不要编造新事实。
`.trim();
}

export function buildMiniMaxNarrativePrompt(rawQuery: string, recommendation: RecommendationResult) {
  const [first, second] = recommendation.topPicks;

  return `
[User Query]
${rawQuery}

[Current Summary]
${recommendation.parsedRequestSummary}

[Pick 1]
name=${first.cafe.name}
location=${first.cafe.locationText}
gate=${first.cafe.nearestGate}
walk=${first.cafe.walkTimeMin}min
price=${first.cafe.priceLevel}
hours=${first.cafe.weekdayHours}
scene=${first.cafe.mainScene}
socket=${first.cafe.socketLevel}
quiet=${first.cafe.quietScore}
why=${first.fitReasons.join(" / ")}
tradeoff=${first.tradeoffs.join(" / ")}

[Pick 2]
name=${second.cafe.name}
location=${second.cafe.locationText}
gate=${second.cafe.nearestGate}
walk=${second.cafe.walkTimeMin}min
price=${second.cafe.priceLevel}
hours=${second.cafe.weekdayHours}
scene=${second.cafe.mainScene}
socket=${second.cafe.socketLevel}
quiet=${second.cafe.quietScore}
why=${second.fitReasons.join(" / ")}
tradeoff=${second.tradeoffs.join(" / ")}

[Writing Goal]
把这次推荐写成适合直接出现在对话框里的 3 行短文本。
`.trim();
}
