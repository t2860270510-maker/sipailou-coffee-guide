import { NextResponse } from "next/server";
import { z } from "zod";

import { getMiniMaxRuntimeSnapshot, recommendWithMiniMaxStream } from "../../../lib/minimax";

const requestSchema = z.object({
  query: z.string().trim().min(2, "请输入更完整一点的需求。"),
});

function toApiErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "推荐服务暂时不可用，请稍后再试。";
  }

  if (/aborted due to timeout|timeout/i.test(error.message)) {
    return "AI 推荐这次响应有点慢，请再试一次。";
  }

  return error.message || "推荐服务暂时不可用，请稍后再试。";
}

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    return await recommendWithMiniMaxStream(payload.query);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          message: error.issues[0]?.message ?? "请求格式不正确。",
        },
        { status: 400 },
      );
    }

    const shouldExposeDebug = process.env.NODE_ENV !== "production" || process.env.MINIMAX_DEBUG === "1";

    return NextResponse.json(
      shouldExposeDebug
        ? {
            message: toApiErrorMessage(error),
            debug: getMiniMaxRuntimeSnapshot(),
          }
        : {
            message: toApiErrorMessage(error),
          },
      { status: 502 },
    );
  }
}
