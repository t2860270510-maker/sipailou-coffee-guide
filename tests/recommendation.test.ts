import assert from "node:assert/strict";

import { cafes } from "../lib/cafes";
import { extractMiniMaxText } from "../lib/minimax";
import { buildCafeContextBlock, buildRecommendationPrompt, MINIMAX_SYSTEM_PROMPT } from "../lib/minimax-prompts";
import { getGuideGroupMatches, parseRecommendationQuery } from "../lib/recommendation";

function run(name: string, assertion: () => void) {
  try {
    assertion();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("system prompt explicitly constrains the model to two cafes and plain text output", () => {
  assert.match(MINIMAX_SYSTEM_PROMPT, /只能推荐 2 家/);
  assert.match(MINIMAX_SYSTEM_PROMPT, /不能编造任何/);
  assert.match(MINIMAX_SYSTEM_PROMPT, /直接输出自然中文/);
});

run("recommendation prompt includes the raw query and all cafe ids", () => {
  const prompt = buildRecommendationPrompt("下午想写论文，最好安静一点");
  assert.match(prompt, /下午想写论文/);
  for (const cafe of cafes) {
    assert.match(prompt, new RegExp(cafe.id));
  }
});

run("cafe context block contains structured facts", () => {
  const context = buildCafeContextBlock();
  assert.match(context, /walk=/);
  assert.match(context, /socket=/);
  assert.match(context, /items=/);
});

run("study group keeps the strongest long-stay option", () => {
  const result = getGuideGroupMatches("study");
  assert.ok(result.some((cafe) => cafe.id === "katherine-starbucks"));
});

run("specialty group includes umber", () => {
  const result = getGuideGroupMatches("specialty");
  assert.ok(result.some((cafe) => cafe.id === "umber"));
});

run("query parser detects study intent and socket preference", () => {
  const parsed = parseRecommendationQuery("下午想写论文，最好安静一点，有插座更好");
  assert.equal(parsed.scene, "study");
  assert.equal(parsed.socketNeed, "preferred");
  assert.equal(parsed.quietNeed, "high");
});

run("recommendation prompt asks for a chat-style reply from the provided cafes", () => {
  const prompt = buildRecommendationPrompt("想和朋友坐坐聊天，离学校近一点");
  assert.match(prompt, /流式输出/);
  assert.match(prompt, /\[Available Cafes\]/);
});

run("non-stream fallback only keeps the assistant text blocks", () => {
  const text = extractMiniMaxText([
    { type: "thinking", thinking: "先想一下" },
    { type: "text", text: "先去凯瑟琳星巴克。" },
    { type: "text", text: "如果嫌远，再看 Disc Coffee。" },
  ]);

  assert.equal(text, "先去凯瑟琳星巴克。如果嫌远，再看 Disc Coffee。");
});
