import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type ListResult = RpcResult & {
  organizationId?: string;
  programs?: Array<Record<string, unknown>>;
};

type CreateResult = RpcResult & {
  programId?: string;
  name?: string;
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
    const res = await callRpc<ListResult>("list_programs", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({
      ok: true,
      programs: res.programs ?? [],
      organizationId: res.organizationId ?? null,
    });
  } catch (error) {
    console.error("[programs:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the programs." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { name?: string; description?: string; icon?: string; items?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Something went wrong. Please try again." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<CreateResult>("create_program", {
      p_session_token: token,
      p_name: body.name,
      p_description: body.description,
      p_icon: body.icon,
      p_items: Array.isArray(body.items) ? body.items : [],
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, programId: res.programId, name: res.name });
  } catch (error) {
    console.error("[programs:create]", error);
    return NextResponse.json(
      { ok: false, message: "We could not create that program." },
      { status: 500 },
    );
  }
}