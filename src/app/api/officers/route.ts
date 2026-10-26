import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type OfficerRow = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  statusLabel: string;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  deactivatedEmail: string | null;
  seat: string | null;
};

type ListPayload = RpcResult & { officers?: OfficerRow[] };

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

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<ListPayload>("list_officers", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, officers: res.officers ?? [] });
  } catch (error) {
    console.error("[officers:list]", error);
    return NextResponse.json(
      { ok: false, message: messageFor("retry") },
      { status: 503 },
    );
  }
}