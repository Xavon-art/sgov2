import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type PurgePayload = RpcResult & {
  purgedEmail?: string;
  purgedName?: string | null;
  seatsFreed?: number;
};

function statusForReason(reason?: string): number {
  switch (reason) {
    case "unauthenticated":
      return 401;
    case "rate_limited":
      return 429;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    default:
      return 400;
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;

  let body: { confirmEmail?: unknown };
  try {
    body = (await request.json()) as { confirmEmail?: unknown };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const confirmEmail = typeof body.confirmEmail === "string" ? body.confirmEmail.trim() : "";

  try {
    const res = await callRpc<PurgePayload>("purge_officer", {
      p_session_token: token,
      p_account_id: id,
      p_confirm_email: confirmEmail,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      purgedEmail: res.purgedEmail,
      purgedName: res.purgedName ?? null,
      seatsFreed: res.seatsFreed ?? 0,
    });
  } catch (error) {
    console.error("[officers:purge]", error);
    return NextResponse.json(
      { ok: false, message: messageFor("retry") },
      { status: 503 },
    );
  }
}