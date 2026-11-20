import { NextResponse } from "next/server";
import { isAiConfigured, isVisionConfigured } from "@/lib/ai/config";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: isAiConfigured(),
    vision: isVisionConfigured(),
  });
}
