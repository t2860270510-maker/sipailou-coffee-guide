import assert from "node:assert/strict";

import { cafes } from "../lib/cafes";
import { extractDeepSeekText, getDeepSeekRuntimeSnapshot } from "../lib/deepseek";
import { buildCafeContextBlock, buildRecommendationPrompt, DEEPSEEK_SYSTEM_PROMPT } from "../lib/deepseek-prompts";
import { formatStaticWalk, getCafeDestination } from "../lib/location";
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
  assert.match(DEEPSEEK_SYSTEM_PROMPT, /只能推荐 2 家/);
  assert.match(DEEPSEEK_SYSTEM_PROMPT, /不能编造任何/);
  assert.match(DEEPSEEK_SYSTEM_PROMPT, /直接输出自然中文/);
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

run("all cafes have map coordinates and image gallery entries", () => {
  for (const cafe of cafes) {
    assert.ok(Number.isFinite(cafe.longitude), `${cafe.id} longitude`);
    assert.ok(Number.isFinite(cafe.latitude), `${cafe.id} latitude`);
    assert.ok(cafe.imageGallery.length >= 1, `${cafe.id} image gallery`);
    assert.ok(cafe.imageGallery.every((image) => image.src && image.alt && image.caption), `${cafe.id} image metadata`);
  }
});

run("cafe destination prefers entrance coordinates when available", () => {
  const cafeMo = cafes.find((cafe) => cafe.id === "cafe-mo");
  assert.ok(cafeMo);

  const destination = getCafeDestination(cafeMo);
  assert.equal(destination.longitude, cafeMo.entranceLongitude);
  assert.equal(destination.latitude, cafeMo.entranceLatitude);
});

run("static walk label keeps the campus reference distance", () => {
  const standingRoom = cafes.find((cafe) => cafe.id === "standing-room");
  assert.ok(standingRoom);
  assert.match(formatStaticWalk(standingRoom), /从南门约 2 分钟 \/ 150m/);
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
  const text = extractDeepSeekText([
    { type: "thinking", thinking: "先想一下" },
    { type: "text", text: "先去凯瑟琳星巴克。" },
    { type: "text", text: "如果嫌远，再看 Disc Coffee。" },
  ]);

  assert.equal(text, "先去凯瑟琳星巴克。如果嫌远，再看 Disc Coffee。");
});

function withEnv(overrides: Record<string, string>, assertion: () => void) {
  const keys = [
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_BASE_URL",
    "DEEPSEEK_MODEL",
    "DEEPSEEK_FALLBACK_MODELS",
    "MINIMAX_API_KEY",
    "MINIMAX_BASE_URL",
    "MINIMAX_MODEL",
    "MINIMAX_FALLBACK_MODELS",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  for (const key of keys) {
    delete process.env[key];
  }
  Object.assign(process.env, overrides);

  try {
    assertion();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

run("runtime snapshot shows DeepSeek defaults when no model env is configured", () => {
  withEnv({}, () => {
    const snapshot = getDeepSeekRuntimeSnapshot();

    assert.equal(snapshot.apiKeyPresent, false);
    assert.equal(snapshot.baseURL, "https://api.deepseek.com/anthropic");
    assert.equal(snapshot.primaryModel, "deepseek-v4-flash");
    assert.deepEqual(snapshot.fallbackModels, []);
  });
});

run("DeepSeek environment variables take priority", () => {
  withEnv(
    {
      DEEPSEEK_API_KEY: "deepseek-key",
      DEEPSEEK_BASE_URL: "https://example.com/deepseek",
      DEEPSEEK_MODEL: "deepseek-v4-flash",
      DEEPSEEK_FALLBACK_MODELS: "deepseek-v4-pro",
      MINIMAX_API_KEY: "minimax-key",
      MINIMAX_BASE_URL: "https://example.com/minimax",
      MINIMAX_MODEL: "MiniMax-M2.7",
    },
    () => {
      const snapshot = getDeepSeekRuntimeSnapshot();

      assert.equal(snapshot.apiKeyPresent, true);
      assert.equal(snapshot.apiKeySource, "DEEPSEEK_API_KEY");
      assert.equal(snapshot.baseURL, "https://example.com/deepseek");
      assert.equal(snapshot.baseURLSource, "DEEPSEEK_BASE_URL");
      assert.equal(snapshot.primaryModel, "deepseek-v4-flash");
      assert.equal(snapshot.primaryModelSource, "DEEPSEEK_MODEL");
      assert.deepEqual(snapshot.fallbackModels, ["deepseek-v4-pro"]);
    },
  );
});

run("legacy MiniMax environment variables remain compatible", () => {
  withEnv(
    {
      MINIMAX_API_KEY: "minimax-key",
      MINIMAX_BASE_URL: "https://api.minimaxi.com/anthropic",
      MINIMAX_MODEL: "MiniMax-M2.5",
      MINIMAX_FALLBACK_MODELS: "MiniMax-M2.7",
    },
    () => {
      const snapshot = getDeepSeekRuntimeSnapshot();

      assert.equal(snapshot.apiKeyPresent, true);
      assert.equal(snapshot.apiKeySource, "MINIMAX_API_KEY");
      assert.equal(snapshot.baseURLSource, "MINIMAX_BASE_URL");
      assert.equal(snapshot.primaryModel, "MiniMax-M2.5");
      assert.equal(snapshot.primaryModelSource, "MINIMAX_MODEL");
      assert.deepEqual(snapshot.fallbackModels, ["MiniMax-M2.7"]);
    },
  );
});
