import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE, type ResolutionDetail } from "@/lib/resolutions";

export const runtime = "nodejs";

type DetailResult = RpcResult & {
  canReview?: boolean;
  item?: ResolutionDetail | null;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

/**
 * One resolution with its review timeline. A row the caller is not allowed to
 * see answers `not_found`, not `forbidden`, so the route never confirms that a
 * unit's private resolution exists.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "That resolution id is not valid." }, { status: 400 });
  }

  try {
    const res = await callRpc<DetailResult>("get_resolution", {
      p_session_token: token,
      p_resolution_id: id,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({
      ok: true,
      canReview: res.canReview === true,
      item: res.item ?? null,
    });
  } catch (error) {
    console.error("[resolutions:detail]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load that resolution." },
      { status: 500 },
    );
  }
}
