import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { readLargeObject } from "@/lib/large-objects";
import { runComplianceCheck, type EngineInput } from "@/lib/compliance/engine";
import type { ComplianceReport } from "@/lib/compliance/types";

export const runtime = "nodejs";

/**
 * Heavy per-call compute (bytes are pulled from Postgres and parsed), so the
 * in-process per-IP layer bounds a single host and the SQL layer's own buckets
 * are untouched. 20 checks per 5 minutes is far more than a reviewer needs.
 */
const IP_LIMIT = 20;
const IP_WINDOW_MS = 5 * 60_000;

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  return 400;
}

type DetailResult = RpcResult & {
  proposal?: {
    id: string;
    title: string;
    status: string;
    eventDate?: string | null;
    venue?: string | null;
    unitName?: string | null;
    programName?: string | null;
    versions?: Array<{
      id: string;
      versionNumber: number;
      submittedBy?: string | null;
      items?: Array<{
        itemId: string;
        submissionId: string | null;
        label: string;
        itemKind: "file" | "link";
        submissionKind: "file" | "link";
        originalName?: string | null;
        sizeBytes?: number | null;
        linkUrl?: string | null;
      }>;
    }>;
  };
};

type DocumentResult = RpcResult & {
  oid?: string | number;
};

async function streamToBuffer(stream: import("node:stream").Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Runs the requirement check over one submitted version.
 *
 * Authorization is inherited, not re-invented: `proposal_detail` answers only for
 * the caller's own organization (owner, reviewer, author, or submitting unit), and
 * `get_document` answers with bytes only for a submission that caller may read. So
 * the route never needs its own scope decision -- it just asks the same two gates
 * the review screen already uses.
 */
export async function POST(req: Request, ctx: { params: Promise<{ versionId: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const limit = rateLimit(`compliance:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: { proposalId?: string } = {};
  try {
    body = (await req.json()) as { proposalId?: string };
  } catch {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  const { versionId } = await ctx.params;
  if (!body.proposalId || !versionId) {
    return NextResponse.json(
      { ok: false, message: messageFor("invalid_request") },
      { status: 400 },
    );
  }

  try {
    const detail = await callRpc<DetailResult>("proposal_detail", {
      p_session_token: token,
      p_proposal_id: body.proposalId,
    });
    if (!detail.ok || !detail.proposal) {
      return NextResponse.json(
        { ok: false, message: messageFor(detail.reason) },
        { status: statusForReason(detail.reason) },
      );
    }

    const proposal = detail.proposal;
    const version = (proposal.versions ?? []).find((v) => v.id === versionId);
    if (!version) {
      return NextResponse.json(
        { ok: false, message: messageFor("not_found") },
        { status: 404 },
      );
    }

    const input: EngineInput = {
      proposalId: proposal.id,
      versionId,
      context: {
        title: proposal.title,
        eventDate: proposal.eventDate ?? null,
        venue: proposal.venue ?? null,
        unitName: proposal.unitName ?? null,
        programName: proposal.programName ?? null,
        submittedBy: version.submittedBy ?? null,
      },
      items: [],
    };

    for (const item of (version.items ?? []).sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    )) {
      const entry: EngineInput["items"][number] = item.submissionId
        ? {
            itemId: item.itemId,
            label: item.label,
            itemKind: item.itemKind,
            submission: {
              submissionId: item.submissionId,
              submissionKind: item.submissionKind,
              originalName: item.originalName ?? undefined,
              sizeBytes: item.sizeBytes ?? undefined,
              linkUrl: item.linkUrl ?? undefined,
            },
          }
        : { itemId: item.itemId, label: item.label, itemKind: item.itemKind };

      if (item.submissionKind === "file" && item.submissionId) {
        try {
          const doc = await callRpc<DocumentResult>("get_document", {
            p_session_token: token,
            p_submission_id: item.submissionId,
          });
          if (doc.ok && doc.oid !== undefined) {
            const { stream } = await readLargeObject(doc.oid);
            entry.buffer = await streamToBuffer(stream);
          } else {
            entry.readError = "get_document refused or missing oid";
          }
        } catch (error) {
          console.error("[compliance:doc]", error);
          entry.readError = "document read failed";
        }
      }

      input.items.push(entry);
    }

    const report: ComplianceReport = await runComplianceCheck(input);
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    console.error("[compliance]", error);
    return NextResponse.json(
      { ok: false, message: "We could not run the requirement check." },
      { status: 500 },
    );
  }
}