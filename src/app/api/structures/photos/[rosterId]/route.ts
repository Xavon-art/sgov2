import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * One officer's photo, as a data URL for an `<img src>`.
 *
 * This is the only way a picture reaches the browser, and it is a separate route
 * for the same reason the document's photo is write-only: a structure read that
 * embedded base64 would ship every seated officer's face inside the JSON of every
 * page load, including for someone who only wanted the seat titles.
 *
 * The scope is the chart's, so an LSG officer cannot fetch a sibling council's
 * roster picture. A miss answers `ok: true` with a null `base64` -- an officer
 * with no picture should render initials, and "no photo" is not a failure.
 */

type PhotoResult = RpcResult & {
  mime?: string | null;
  bytes?: number;
  base64?: string | null;
};

export async function GET(_req: Request, ctx: { params: Promise<{ rosterId: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { rosterId } = await ctx.params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rosterId)) {
    return NextResponse.json({ ok: false, message: "That is not a member." }, { status: 400 });
  }

  try {
    const res = await callRpc<PhotoResult>("get_member_photo", {
      p_session_token: token,
      p_roster_id: rosterId,
    });

    if (!res.ok) {
      // `forbidden` and `not_found` collapse to the same answer, because the
      // difference would confirm that a person exists somewhere in the org.
      return NextResponse.json({ ok: true, mime: null, bytes: 0, base64: null });
    }

    return NextResponse.json(res);
  } catch (error) {
    console.error("[structures:photo]", error);
    return NextResponse.json({ ok: true, mime: null, bytes: 0, base64: null });
  }
}