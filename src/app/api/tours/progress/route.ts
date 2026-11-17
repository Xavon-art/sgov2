import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type StringMap = Record<string, string>;

type GetPayload = RpcResult & {
  completed?: unknown;
  dismissed?: unknown;
  sidebarCollapsed?: unknown;
};

type ProgressBody = {
  completed?: unknown;
  dismissed?: unknown;
  sidebarCollapsed?: unknown;
};

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMap(value: unknown): StringMap {
  const out: StringMap = Object.create(null) as StringMap;
  if (!isMap(value)) return out;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({
      ok: true,
      completed: {},
      dismissed: {},
      sidebarCollapsed: false,
    });
  }

  try {
    const res = await callRpc<GetPayload>("get_tour_progress", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: 403 },
      );
    }
    return NextResponse.json({
      ok: true,
      completed: normalizeMap(res.completed),
      dismissed: normalizeMap(res.dismissed),
      sidebarCollapsed: typeof res.sidebarCollapsed === "boolean" ? res.sidebarCollapsed : false,
    });
  } catch (error) {
    console.error("[tours:progress:get]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: true });
  }

  let body: ProgressBody | null;
  try {
    body = (await request.json()) as ProgressBody | null;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  if (
    !body ||
    !isMap(body.completed) ||
    !isMap(body.dismissed) ||
    typeof body.sidebarCollapsed !== "boolean"
  ) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  try {
    const res = await callRpc<RpcResult>("save_tour_progress", {
      p_session_token: token,
      p_completed: body.completed,
      p_dismissed: body.dismissed,
      p_sidebar_collapsed: body.sidebarCollapsed,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: 403 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[tours:progress:put]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}
