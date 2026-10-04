import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type ListResult = RpcResult & {
  programs?: Array<Record<string, unknown>>;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  return 400;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;
  try {
    const res = await callRpc<ListResult>("list_programs", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }
    const program = (res.programs ?? []).find((p) => p.id === id);
    if (!program) {
      return NextResponse.json(
        { ok: false, message: "We could not find that program." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, program });
  } catch (error) {
    console.error("[programs:detail]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load that program." },
      { status: 500 },
    );
  }
}