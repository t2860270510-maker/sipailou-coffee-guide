import { createHash } from "node:crypto";

import { buildRecommendationPrompt, DEEPSEEK_SYSTEM_PROMPT } from "./deepseek-prompts";

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

type DeepSeekSuccessResponse = {
  model?: string;
  content?: Array<{
    type?: string;
    text?: string;
    thinking?: string;
  }>;
  error?: {
    message?: string;
    request_id?: string;
    type?: string;
    code?: string;
  };
};

function getFirstEnv(candidates: string[]) {
  for (const name of candidates) {
    const value = process.env[name];
    if (value) {
      return { value, source: name };
    }
  }

  return { value: null, source: null };
}

function splitModelList(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getDeepSeekConfig() {
  const apiKey = getFirstEnv(["DEEPSEEK_API_KEY", "MINIMAX_API_KEY", "ANTHROPIC_API_KEY"]);
  const baseURL = getFirstEnv(["DEEPSEEK_BASE_URL", "MINIMAX_BASE_URL", "ANTHROPIC_BASE_URL"]);
  const primaryModel = getFirstEnv(["DEEPSEEK_MODEL", "MINIMAX_MODEL", "ANTHROPIC_MODEL"]);
  const fallbackModels = getFirstEnv(["DEEPSEEK_FALLBACK_MODELS", "MINIMAX_FALLBACK_MODELS"]);

  if (!apiKey.value) {
    return null;
  }

  return {
    apiKey: apiKey.value,
    apiKeySource: apiKey.source,
    baseURL: baseURL.value ?? DEFAULT_DEEPSEEK_BASE_URL,
    baseURLSource: baseURL.source ?? "default",
    primaryModelSource: primaryModel.source ?? "default",
    models: Array.from(new Set([primaryModel.value ?? DEFAULT_DEEPSEEK_MODEL, ...splitModelList(fallbackModels.value)])),
  };
}

export function getDeepSeekRuntimeSnapshot() {
  const config = getDeepSeekConfig();

  return {
    apiKeyPresent: Boolean(config?.apiKey),
    apiKeySource: config?.apiKeySource ?? null,
    apiKeyFingerprint: config?.apiKey
      ? createHash("sha256").update(config.apiKey).digest("hex").slice(0, 12)
      : null,
    baseURL: config?.baseURL ?? DEFAULT_DEEPSEEK_BASE_URL,
    baseURLSource: config?.baseURLSource ?? "default",
    primaryModel: config?.models[0] ?? DEFAULT_DEEPSEEK_MODEL,
    primaryModelSource: config?.primaryModelSource ?? "default",
    fallbackModels: config ? config.models.slice(1) : [],
    nodeEnv: process.env.NODE_ENV ?? null,
  };
}

function buildDeepSeekError(error: DeepSeekSuccessResponse["error"], model: string) {
  const message = error?.message ?? "DeepSeek 请求失败。";
  const requestId = error?.request_id ? ` request_id=${error.request_id}` : "";

  if (error?.code === "unknown_model" || /unable to find suitable provider/i.test(message)) {
    return new Error(`当前模型 ${model} 在这个环境里不可用。${requestId}`);
  }

  if (error?.type === "api_error" && /system error/i.test(message)) {
    return new Error(`DeepSeek 服务临时异常：${message}${requestId}`);
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

async function createDeepSeekStream({
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
      system: DEEPSEEK_SYSTEM_PROMPT,
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

  const payload = (await response.json().catch(() => ({}))) as DeepSeekSuccessResponse;
  throw buildDeepSeekError(payload.error, model);
}

function extractTextDelta(payload: Record<string, unknown>) {
  const delta = payload.delta;
  if (!delta || typeof delta !== "object") {
    return "";
  }

  const text = (delta as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

export function extractDeepSeekText(content: DeepSeekSuccessResponse["content"] | null | undefined) {
  if (!content?.length) {
    return "";
  }

  return content
    .map((block) => (block?.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("")
    .trim();
}

async function createDeepSeekText({
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
      system: DEEPSEEK_SYSTEM_PROMPT,
      max_tokens: 900,
      temperature: 0.3,
      stream: false,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ],
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as DeepSeekSuccessResponse;

  if (!response.ok) {
    throw buildDeepSeekError(payload.error, model);
  }

  const text = extractDeepSeekText(payload.content);
  if (text) {
    return text;
  }

  throw new Error("模型返回了空内容。");
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

export async function recommendWithDeepSeekStream(rawQuery: string) {
  const config = getDeepSeekConfig();
  if (!config) {
    throw new Error("当前没有可用的模型配置。");
  }

  const prompt = buildRecommendationPrompt(rawQuery);

  for (const model of config.models) {
    let streamError: unknown = null;

    try {
      const response = await createDeepSeekStream({
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
      streamError = error;
    }

    try {
      const text = await createDeepSeekText({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        model,
        prompt,
      });

      return new Response(text, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      if (
        shouldTryNextModel(error, model, config.models) ||
        shouldTryNextModel(streamError, model, config.models)
      ) {
        continue;
      }

      throw error instanceof Error ? error : streamError;
    }
  }

  throw new Error("模型暂时不可用，请稍后再试。");
}
