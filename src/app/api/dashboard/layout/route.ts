import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * The signed-in officer's own dashboard arrangement.
 *
 * GET returns whatever was saved, or an empty array for a first visit -- the
 * client falls back to its nav order, so "never arranged" and "arranged to the
 * default" look the same without a server-side default to keep in step.
 *
 * PUT replaces the whole arrangement. A layout is small (a handful of tiles),
 * so a partial patch would add merge semantics for no gain, and whole-document
 * writes make the last save the truth no matter how many tabs are open.
 */

type LayoutItem = { id: string; hidden: boolean; wide: boolean };

type GetPayload = RpcResult & { layout?: LayoutItem[] };

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<GetPayload>("get_dashboard_layout", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: 403 },
      );
    }
    return NextResponse.json({ ok: true, layout: Array.isArray(res.layout) ? res.layout : [] });
  } catch (error) {
    console.error("[dashboard:layout:get]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { layout?: unknown };
  try {
    body = (await request.json()) as { layout?: unknown };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  if (!Array.isArray(body.layout)) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  try {
    const res = await callRpc<RpcResult>("save_dashboard_layout", {
      p_session_token: token,
      // The function normalises and rejects; the route does not try to be a
      // second validator, because two validators that disagree is worse than one.
      p_layout: body.layout,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[dashboard:layout:put]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}
