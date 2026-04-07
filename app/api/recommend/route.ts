import { NextResponse } from "next/server";
import { z } from "zod";

import { getMiniMaxRuntimeSnapshot, recommendWithMiniMax } from "../../../lib/minimax";

const requestSchema = z.object({
  query: z.string().trim().min(2, "请输入更完整一点的需求。"),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const recommendation = await recommendWithMiniMax(payload.query);
    return NextResponse.json(recommendation);
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
            message: error instanceof Error ? error.message : "推荐服务暂时不可用，请稍后再试。",
            debug: getMiniMaxRuntimeSnapshot(),
          }
        : {
            message: error instanceof Error ? error.message : "推荐服务暂时不可用，请稍后再试。",
          },
      { status: 502 },
    );
  }
}
