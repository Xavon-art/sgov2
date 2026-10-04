import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type DefaultsResult = RpcResult & {
  items?: Array<Record<string, unknown>>;
  count?: number;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  return 400;
}

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<DefaultsResult>("list_default_requirements", {
      p_session_token: token,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, items: res.items ?? [] });
  } catch (error) {
    console.error("[requirements:defaults:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the default requirements." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { items?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Something went wrong. Please try again." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<DefaultsResult>("set_default_requirements", {
      p_session_token: token,
      p_items: Array.isArray(body.items) ? body.items : [],
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, count: res.count });
  } catch (error) {
    console.error("[requirements:defaults:set]", error);
    return NextResponse.json(
      { ok: false, message: "We could not update the default requirements." },
      { status: 500 },
    );
  }
}