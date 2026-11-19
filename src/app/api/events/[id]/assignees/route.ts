import { NextResponse } from "next/server";
import { z } from "zod";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AssigneeRow = {
  accountId: string;
  displayName: string;
  email: string;
};

type ListAssigneesResult = RpcResult & {
  canAssign?: boolean;
  assignees?: AssigneeRow[];
  candidates?: AssigneeRow[];
};

type SetAssigneesResult = RpcResult & { count?: number };

const PutSchema = z.object({
  accountIds: z.array(z.string().regex(UUID_RE)).max(200),
});

function statusForReason(reason?: string): number {
  switch (reason) {
    case "unauthenticated":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    default:
      return 400;
  }
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "That event reference is not valid." }, { status: 400 });
  }

  try {
    const res = await callRpc<ListAssigneesResult>("list_event_assignees", {
      p_session_token: token,
      p_event_id: id,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({
      ok: true,
      canAssign: res.canAssign === true,
      assignees: res.assignees ?? [],
      candidates: res.candidates ?? [],
    });
  } catch (error) {
    console.error("[events:assignees:list]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "That event reference is not valid." }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }
  const parsed = PutSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_assignees"), reason: "invalid_assignees" },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<SetAssigneesResult>("set_event_assignees", {
      p_session_token: token,
      p_event_id: id,
      p_account_ids: parsed.data.accountIds,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, count: res.count ?? 0 });
  } catch (error) {
    console.error("[events:assignees:update]", error);
    return NextResponse.json({ ok: false, message: messageFor("retry") }, { status: 503 });
  }
}
