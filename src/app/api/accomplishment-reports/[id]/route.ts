import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import {
  getAccomplishmentReport,
  UUID_RE,
  type AccomplishmentReportDetail,
} from "@/lib/accomplishment-reports";

export const runtime = "nodejs";

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

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
    return NextResponse.json(
      { ok: false, message: "That report reference is not valid." },
      { status: 400 },
    );
  }

  try {
    const res = await getAccomplishmentReport(token, id);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({
      ok: true,
      canReview: res.canReview === true,
      item: (res.item ?? null) as AccomplishmentReportDetail | null,
    });
  } catch (error) {
    console.error("[accomplishment-reports:detail]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load that accomplishment report." },
      { status: 500 },
    );
  }
}
