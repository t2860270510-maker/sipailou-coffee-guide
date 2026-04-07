import { createHash } from "node:crypto";

import { buildMiniMaxNarrativePrompt, MINIMAX_SYSTEM_PROMPT } from "./minimax-prompts";
import { buildLocalRecommendation } from "./recommendation";
import type { RecommendationResult } from "./types";

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

type MiniMaxNarrative = {
  explanation: string;
  comparisonNote: string;
  tradeoffNote: string;
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

function parseNarrativeText(text: string): MiniMaxNarrative | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const findLine = (prefix: string) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim();

  const explanation = findLine("概述：");
  const comparisonNote = findLine("对比：");
  const tradeoffNote = findLine("提醒：");

  if (!explanation || !comparisonNote || !tradeoffNote) {
    return null;
  }

  return {
    explanation,
    comparisonNote,
    tradeoffNote,
  };
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
      max_tokens: 220,
      temperature: 0.2,
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

async function enhanceWithMiniMax(rawQuery: string, recommendation: RecommendationResult) {
  const config = getMiniMaxConfig();
  if (!config) {
    return null;
  }

  const prompt = buildMiniMaxNarrativePrompt(rawQuery, recommendation);

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

      const parsed = parseNarrativeText(text);
      if (!parsed) {
        continue;
      }

      return {
        ...parsed,
        modelUsed: message.model ?? model,
      };
    } catch (error) {
      if (shouldTryNextModel(error, model, config.models)) {
        continue;
      }

      return null;
    }
  }

  return null;
}

export async function recommendWithMiniMax(rawQuery: string): Promise<RecommendationResult> {
  const localRecommendation = buildLocalRecommendation(rawQuery);
  const enhanced = await enhanceWithMiniMax(rawQuery, localRecommendation);

  if (!enhanced) {
    return localRecommendation;
  }

  return {
    ...localRecommendation,
    explanation: enhanced.explanation,
    comparisonNote: enhanced.comparisonNote,
    tradeoffNote: enhanced.tradeoffNote,
    modelUsed: `${enhanced.modelUsed} + local picks`,
  };
}
