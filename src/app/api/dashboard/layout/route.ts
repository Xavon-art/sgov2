import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type LayoutItem = { id: string; hidden: boolean; wide: boolean };

type PreferencesPayload = RpcResult & {
  layout?: LayoutItem[];
  widgets?: string[];
};

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<PreferencesPayload>("get_dashboard_preferences", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: 403 },
      );
    }
    return NextResponse.json({
      ok: true,
      layout: Array.isArray(res.layout) ? res.layout : [],
      widgets: Array.isArray(res.widgets) ? res.widgets : [],
    });
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

  let body: { layout?: unknown; widgets?: unknown };
  try {
    body = (await request.json()) as { layout?: unknown; widgets?: unknown };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  if (!Array.isArray(body.layout) || !Array.isArray(body.widgets)) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  try {
    const res = await callRpc<RpcResult>("save_dashboard_preferences", {
      p_session_token: token,
      p_layout: body.layout,
      p_widgets: body.widgets,
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
