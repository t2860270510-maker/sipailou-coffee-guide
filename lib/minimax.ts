import { createHash } from "node:crypto";

import { cafes } from "./cafes";
import { buildRecommendationPrompt, MINIMAX_SYSTEM_PROMPT } from "./minimax-prompts";
import { parseRecommendationQuery } from "./recommendation";
import type { RankedCafe, RecommendationResult } from "./types";

type MiniMaxSuccessResponse = {
  model?: string;
  content?: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: "thinking";
        thinking: string;
      }
  >;
};

type MiniMaxErrorResponse = {
  error?: {
    message?: string;
    request_id?: string;
    type?: string;
    code?: string;
  };
};

type MiniMaxRecommendationPayload = {
  parsedRequestSummary: string;
  explanation: string;
  comparisonNote: string;
  tradeoffNote: string;
  picks: Array<{
    id: string;
    fitReasons: string[];
    tradeoffs: string[];
  }>;
};

function getMiniMaxConfig() {
  const apiKey = process.env.MINIMAX_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  const apiKeySource = process.env.MINIMAX_API_KEY
    ? "MINIMAX_API_KEY"
    : process.env.ANTHROPIC_API_KEY
      ? "ANTHROPIC_API_KEY"
      : null;
  const baseURL =
    process.env.MINIMAX_BASE_URL ??
    process.env.ANTHROPIC_BASE_URL ??
    "https://api.minimaxi.com/anthropic";
  const baseURLSource = process.env.MINIMAX_BASE_URL
    ? "MINIMAX_BASE_URL"
    : process.env.ANTHROPIC_BASE_URL
      ? "ANTHROPIC_BASE_URL"
      : "default";
  const primaryModel = process.env.MINIMAX_MODEL ?? process.env.ANTHROPIC_MODEL ?? "MiniMax-M2.7";
  const primaryModelSource = process.env.MINIMAX_MODEL
    ? "MINIMAX_MODEL"
    : process.env.ANTHROPIC_MODEL
      ? "ANTHROPIC_MODEL"
      : "default";
  const fallbackModels = (process.env.MINIMAX_FALLBACK_MODELS ?? "MiniMax-M2.5")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    apiKeySource,
    baseURL,
    baseURLSource,
    primaryModelSource,
    models: Array.from(new Set([primaryModel, ...fallbackModels])),
  };
}

export function getMiniMaxRuntimeSnapshot() {
  const config = getMiniMaxConfig();

  return {
    apiKeyPresent: Boolean(config?.apiKey),
    apiKeySource: config?.apiKeySource ?? null,
    apiKeyFingerprint: config?.apiKey
      ? createHash("sha256").update(config.apiKey).digest("hex").slice(0, 12)
      : null,
    baseURL: config?.baseURL ?? "https://api.minimaxi.com/anthropic",
    baseURLSource: config?.baseURLSource ?? "default",
    primaryModel: config?.models[0] ?? "MiniMax-M2.7",
    primaryModelSource: config?.primaryModelSource ?? "default",
    fallbackModels: config ? config.models.slice(1) : ["MiniMax-M2.5"],
    nodeEnv: process.env.NODE_ENV ?? null,
  };
}

function buildMiniMaxError(error: MiniMaxErrorResponse["error"], model: string) {
  const message = error?.message ?? "MiniMax 请求失败。";
  const requestId = error?.request_id ? ` request_id=${error.request_id}` : "";

  if (error?.code === "unknown_model" || /unable to find suitable provider/i.test(message)) {
    return new Error(`当前模型 ${model} 在这个环境里不可用。${requestId}`);
  }

  if (error?.type === "api_error" && /system error/i.test(message)) {
    return new Error(`MiniMax 服务临时异常：${message}${requestId}`);
  }

  return new Error(`${message}${requestId}`);
}

function normalizeJsonPayload(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1).trim();
  }

  return text.trim();
}

function isValidPick(pick: MiniMaxRecommendationPayload["picks"][number]) {
  return (
    typeof pick?.id === "string" &&
    Array.isArray(pick.fitReasons) &&
    pick.fitReasons.every((item) => typeof item === "string" && item.trim().length > 0) &&
    Array.isArray(pick.tradeoffs) &&
    pick.tradeoffs.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function parseRecommendationPayload(text: string): MiniMaxRecommendationPayload | null {
  try {
    const parsed = JSON.parse(normalizeJsonPayload(text)) as Partial<MiniMaxRecommendationPayload>;
    if (
      typeof parsed.parsedRequestSummary !== "string" ||
      typeof parsed.explanation !== "string" ||
      typeof parsed.comparisonNote !== "string" ||
      typeof parsed.tradeoffNote !== "string" ||
      !Array.isArray(parsed.picks) ||
      parsed.picks.length !== 2 ||
      !parsed.picks.every(isValidPick)
    ) {
      return null;
    }

    const uniqueIds = new Set(parsed.picks.map((pick) => pick.id));
    if (uniqueIds.size !== 2) {
      return null;
    }

    return {
      parsedRequestSummary: parsed.parsedRequestSummary.trim(),
      explanation: parsed.explanation.trim(),
      comparisonNote: parsed.comparisonNote.trim(),
      tradeoffNote: parsed.tradeoffNote.trim(),
      picks: parsed.picks.map((pick) => ({
        id: pick.id.trim(),
        fitReasons: pick.fitReasons.map((item) => item.trim()).filter(Boolean).slice(0, 3),
        tradeoffs: pick.tradeoffs.map((item) => item.trim()).filter(Boolean).slice(0, 2),
      })),
    };
  } catch {
    return null;
  }
}

function hydrateRankedCafes(picks: MiniMaxRecommendationPayload["picks"]): RankedCafe[] | null {
  const hydrated = picks.map((pick) => {
    const cafe = cafes.find((item) => item.id === pick.id);
    if (!cafe) {
      return null;
    }

    return {
      cafe,
      fitReasons: pick.fitReasons,
      tradeoffs: pick.tradeoffs,
    };
  });

  return hydrated.every(Boolean) ? (hydrated as RankedCafe[]) : null;
}

async function createMiniMaxMessage({
  apiKey,
  baseURL,
  model,
  prompt,
}: {
  apiKey: string;
  baseURL: string;
  model: string;
  prompt: string;
}) {
  const response = await fetch(`${baseURL.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(6500),
    body: JSON.stringify({
      model,
      system: MINIMAX_SYSTEM_PROMPT,
      max_tokens: 900,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ],
    }),
  });

  const payload = (await response.json()) as MiniMaxSuccessResponse & MiniMaxErrorResponse;
  if (response.ok) {
    return payload;
  }

  throw buildMiniMaxError(payload.error, model);
}

function shouldTryNextModel(error: unknown, currentModel: string, allModels: string[]) {
  if (!(error instanceof Error)) {
    return false;
  }

  const hasNextModel = allModels.indexOf(currentModel) < allModels.length - 1;
  return hasNextModel && /不可用|unknown_model|unable to find suitable provider/i.test(error.message);
}

async function enhanceWithMiniMax(rawQuery: string): Promise<RecommendationResult> {
  const config = getMiniMaxConfig();
  if (!config) {
    throw new Error("当前版本的推荐需要可用的 MiniMax API Key，暂时不能回退到本地推荐。");
  }

  const prompt = buildRecommendationPrompt(rawQuery);

  for (const model of config.models) {
    try {
      const message = await createMiniMaxMessage({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        model,
        prompt,
      });

      const text = (message.content ?? [])
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      if (!text) {
        continue;
      }

      const parsed = parseRecommendationPayload(text);
      if (!parsed) {
        continue;
      }

      const topPicks = hydrateRankedCafes(parsed.picks);
      if (!topPicks) {
        continue;
      }

      return {
        parsedRequest: parseRecommendationQuery(rawQuery),
        parsedRequestSummary: parsed.parsedRequestSummary,
        topPicks,
        explanation: parsed.explanation,
        comparisonNote: parsed.comparisonNote,
        tradeoffNote: parsed.tradeoffNote,
        modelUsed: message.model ?? model,
      };
    } catch (error) {
      if (shouldTryNextModel(error, model, config.models)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("模型没有返回可用的推荐结果，请稍后再试。");
}

export async function recommendWithMiniMax(rawQuery: string): Promise<RecommendationResult> {
  return enhanceWithMiniMax(rawQuery);
}
