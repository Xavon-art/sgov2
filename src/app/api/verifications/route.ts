import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * Document verification: `GET` the checklist for a proposal, `POST` a verdict on
 * one submission.
 *
 * Both calls re-scope the caller inside Postgres. A verdict is a reviewer's opinion
 * about a file they were entitled to open, and nothing here decides that -- it only
 * decides what to say back. Which verdict values exist is a database enum, so an
 * unknown one is refused there rather than trusted from the browser.
 *
 * `GET ?proposalId=...` is readable by the author as well as by reviewers, on
 * purpose: an author who cannot see that their document was queried cannot answer
 * the question.
 */

const VERDICTS = new Set(["verified", "queried", "rejected"]);

type ListResult = RpcResult & {
  items?: Array<{
    submissionId: string;
    label: string;
    itemKind: string;
    submissionKind: string;
    originalName?: string | null;
    linkUrl?: string | null;
    hasDocument: boolean;
    verdict?: string | null;
    remark?: string | null;
    verifiedBy?: string | null;
    verifiedAt?: string | null;
    myVerdict?: string | null;
    myRemark?: string | null;
    reviewerCount?: number;
  }>;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  return 400;
}

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const proposalId = new URL(req.url).searchParams.get("proposalId");
  if (!proposalId) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<ListResult>("list_verifications", {
      p_session_token: token,
      p_proposal_id: proposalId,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true, items: res.items ?? [] });
  } catch (error) {
    console.error("[verifications:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the checklist." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { submissionId?: string; verdict?: string; remark?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  const verdict = (body.verdict ?? "").trim();
  const remark = (body.remark ?? "").trim();

  if (!body.submissionId || !VERDICTS.has(verdict)) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  // A question needs a question attached. Checked here so the reviewer is told
  // before the round trip, and the database checks it again because a route is not
  // a boundary.
  if (verdict === "queried" && remark.length === 0) {
    return NextResponse.json(
      { ok: false, message: messageFor("remark_required") },
      { status: 400 },
    );
  }

  if (remark.length > 1000) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<RpcResult & { verdict?: string }>("verify_submission", {
      p_session_token: token,
      p_submission_id: body.submissionId,
      p_verdict: verdict,
      p_remark: remark,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true, submissionId: body.submissionId, verdict: res.verdict });
  } catch (error) {
    console.error("[verifications:verify]", error);
    return NextResponse.json(
      { ok: false, message: "We could not record that ruling." },
      { status: 500 },
    );
  }
}