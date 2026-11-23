import { NextResponse } from "next/server";
import { isVisionConfigured } from "@/lib/ai/config";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: true,
    vision: isVisionConfigured(),
  });
}
