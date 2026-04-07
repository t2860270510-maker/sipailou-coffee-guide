import { createHash } from "node:crypto";

import { buildRecommendationPrompt, MINIMAX_SYSTEM_PROMPT } from "./minimax-prompts";

type MiniMaxSuccessResponse = {
  model?: string;
  error?: {
    message?: string;
    request_id?: string;
    type?: string;
    code?: string;
  };
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

function buildMiniMaxError(error: MiniMaxSuccessResponse["error"], model: string) {
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

function shouldTryNextModel(error: unknown, currentModel: string, allModels: string[]) {
  if (!(error instanceof Error)) {
    return false;
  }

  const hasNextModel = allModels.indexOf(currentModel) < allModels.length - 1;
  return hasNextModel && /不可用|unknown_model|unable to find suitable provider/i.test(error.message);
}

async function createMiniMaxStream({
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
    body: JSON.stringify({
      model,
      system: MINIMAX_SYSTEM_PROMPT,
      max_tokens: 900,
      temperature: 0.3,
      stream: true,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ],
    }),
  });

  if (response.ok && response.body) {
    return response;
  }

  const payload = (await response.json().catch(() => ({}))) as MiniMaxSuccessResponse;
  throw buildMiniMaxError(payload.error, model);
}

function extractTextDelta(payload: Record<string, unknown>) {
  const delta = payload.delta;
  if (!delta || typeof delta !== "object") {
    return "";
  }

  const text = (delta as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function sseToTextStream(stream: ReadableStream<Uint8Array>) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = stream.getReader();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          while (true) {
            const boundary = buffer.indexOf("\n\n");
            if (boundary === -1) {
              break;
            }

            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);

            const data = rawEvent
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");

            if (!data || data === "[DONE]") {
              continue;
            }

            const payload = JSON.parse(data) as Record<string, unknown>;
            const deltaText = extractTextDelta(payload);
            if (deltaText) {
              controller.enqueue(encoder.encode(deltaText));
            }
          }
        }

        const trailing = decoder.decode();
        if (trailing) {
          buffer += trailing;
        }
      } catch {
        controller.enqueue(encoder.encode("\n\n抱歉，这次回复中断了，你可以再发一次。"));
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}

export async function recommendWithMiniMaxStream(rawQuery: string) {
  const config = getMiniMaxConfig();
  if (!config) {
    throw new Error("当前没有可用的模型配置。");
  }

  const prompt = buildRecommendationPrompt(rawQuery);

  for (const model of config.models) {
    try {
      const response = await createMiniMaxStream({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        model,
        prompt,
      });

      return new Response(sseToTextStream(response.body as ReadableStream<Uint8Array>), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      if (shouldTryNextModel(error, model, config.models)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("模型暂时不可用，请稍后再试。");
}
