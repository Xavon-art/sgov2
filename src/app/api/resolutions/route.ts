import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE, type ResolutionRow } from "@/lib/resolutions";

export const runtime = "nodejs";

type ListResult = RpcResult & { canReview?: boolean; rows?: ResolutionRow[] };
type CreateResult = RpcResult & { id?: string };

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

/**
 * Every resolution the caller is allowed to see. The visibility rule lives in
 * SQL: USG sees the whole organisation, an LSG officer sees their own unit plus
 * the org-wide rows the office has already approved or published.
 */
export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<ListResult>("list_resolutions", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      canReview: res.canReview === true,
      rows: res.rows ?? [],
    });
  } catch (error) {
    console.error("[resolutions:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the resolutions." },
      { status: 500 },
    );
  }
}

/**
 * A new resolution. The caller's identity, unit and organisation are all
 * resolved inside SQL from the session, so `unitId` is only ever a hint a USG
 * officer may use to scope the row to one of their units.
 */
export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { title?: unknown; body?: unknown; unitId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Send the resolution as JSON." },
      { status: 400 },
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 4 || title.length > 160) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_title"), reason: "invalid_title" },
      { status: 400 },
    );
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (text.length < 10) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_body"), reason: "invalid_body" },
      { status: 400 },
    );
  }

  let unitId: string | null = null;
  if (typeof body.unitId === "string" && body.unitId.trim()) {
    unitId = body.unitId.trim();
    if (!UUID_RE.test(unitId)) {
      return NextResponse.json(
        { ok: false, message: "That unit reference is not valid." },
        { status: 400 },
      );
    }
  }

  try {
    const res = await callRpc<CreateResult>("create_resolution", {
      p_session_token: token,
      p_title: title,
      p_body: text,
      p_unit_id: unitId,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true, id: res.id });
  } catch (error) {
    console.error("[resolutions:create]", error);
    return NextResponse.json(
      { ok: false, message: "We could not file that resolution." },
      { status: 500 },
    );
  }
}
