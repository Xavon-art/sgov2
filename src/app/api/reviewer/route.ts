import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type ReviewerResult = RpcResult & {
  reviewer?: boolean;
};

/**
 * Whether the signed-in account sits on the USG board (owner or an invited
 * officer flagged as a reviewer). The shells use this to decide which view to
 * render before any proposal data is fetched.
 */
export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<ReviewerResult>("am_i_reviewer", {
      p_session_token: token,
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 401 });
    }
    return NextResponse.json({ ok: true, reviewer: res.reviewer === true });
  } catch (error) {
    console.error("[reviewer:read]", error);
    return NextResponse.json(
      { ok: false, message: "We could not check your review access." },
      { status: 500 },
    );
  }
}