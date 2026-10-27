import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, message: "Not available." }, { status: 404 });
  }
  try {
    const res = await callRpc<RpcResult & { entries?: unknown }>("list_outbox", { p_limit: 100 });
    if (!res.ok) {
      return NextResponse.json({ ok: false, message: "Could not load outbox." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, entries: res.entries ?? [] });
  } catch (error) {
    console.error("[dev:outbox]", error);
    return NextResponse.json({ ok: false, message: "Could not load outbox." }, { status: 503 });
  }
}