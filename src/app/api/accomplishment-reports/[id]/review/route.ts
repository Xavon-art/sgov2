import { NextResponse } from "next/server";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import {
  UUID_RE,
  type AccomplishmentDecision,
} from "@/lib/accomplishment-reports";
import { reviewAccomplishmentReport } from "@/lib/accomplishment-reports-server";

export const runtime = "nodejs";

const DECISIONS = new Set<AccomplishmentDecision>(["approved", "returned"]);

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

export async function POST(
  req: Request,
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

  let body: { decision?: unknown; remark?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Send the decision as JSON." },
      { status: 400 },
    );
  }

  const decision = typeof body.decision === "string" ? body.decision : "";
  if (!DECISIONS.has(decision as unknown as AccomplishmentDecision)) {
    return NextResponse.json(
      { ok: false, message: "Choose approve or return." },
      { status: 400 },
    );
  }

  const remark = typeof body.remark === "string" ? body.remark.trim() : "";
  if (decision === "returned" && !remark) {
    return NextResponse.json(
      { ok: false, message: messageFor("remark_required"), reason: "remark_required" },
      { status: 400 },
    );
  }

  try {
    const res = await reviewAccomplishmentReport(
      token,
      id,
      decision as AccomplishmentDecision,
      remark,
    );
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, id: res.id, status: res.status });
  } catch (error) {
    console.error("[accomplishment-reports:review]", error);
    return NextResponse.json(
      { ok: false, message: "We could not record that decision." },
      { status: 500 },
    );
  }
}
