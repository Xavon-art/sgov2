import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE, type DocumentGroupKind } from "@/lib/document-search";

export const runtime = "nodejs";

type UpdateResult = RpcResult;

const GROUP_KINDS = new Set<DocumentGroupKind>(["requirement", "resolution", "event"]);

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  return 400;
}

/**
 * Describe one filed document. The uploader, the proposal author and a reviewer
 * may edit; the database proves which of those the caller is. A metadata change
 * sends an approved row back to pending, because an approved title that later
 * says something else would be a trust bug.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ submissionId: string }> },
) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { submissionId } = await ctx.params;
  if (!UUID_RE.test(submissionId)) {
    return NextResponse.json(
      { ok: false, message: "That document reference is not valid." },
      { status: 400 },
    );
  }

  let body: {
    title?: unknown;
    description?: unknown;
    keywords?: unknown;
    groupKind?: unknown;
    groupId?: unknown;
    groupLabel?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Send the document details as JSON." },
      { status: 400 },
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 2 || title.length > 160) {
    return NextResponse.json(
      { ok: false, message: "Give the document a title of 2 to 160 characters." },
      { status: 400 },
    );
  }

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length > 2000) {
    return NextResponse.json(
      { ok: false, message: "Keep the description under 2,000 characters." },
      { status: 400 },
    );
  }

  const keywords = typeof body.keywords === "string" ? body.keywords.trim() : "";
  if (keywords.length > 500) {
    return NextResponse.json(
      { ok: false, message: "Keep the keywords under 500 characters." },
      { status: 400 },
    );
  }

  const groupKind = typeof body.groupKind === "string" ? body.groupKind.trim() : "";
  if (groupKind && !GROUP_KINDS.has(groupKind as DocumentGroupKind)) {
    return NextResponse.json(
      { ok: false, message: "Choose requirement, resolution, or event." },
      { status: 400 },
    );
  }

  let groupId: string | null = null;
  if (typeof body.groupId === "string" && body.groupId.trim()) {
    groupId = body.groupId.trim();
    if (!UUID_RE.test(groupId)) {
      return NextResponse.json(
        { ok: false, message: "That group reference is not valid." },
        { status: 400 },
      );
    }
  }

  const groupLabel = typeof body.groupLabel === "string" ? body.groupLabel.trim() : "";
  if (groupLabel.length > 160) {
    return NextResponse.json(
      { ok: false, message: "Keep the group label under 160 characters." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<UpdateResult>("set_document_metadata", {
      p_session_token: token,
      p_submission_id: submissionId,
      p_title: title,
      p_description: description,
      p_keywords: keywords,
      p_group_kind: groupKind || null,
      p_group_id: groupId,
      p_group_label: groupLabel || null,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[documents:update]", error);
    return NextResponse.json(
      { ok: false, message: "We could not save those document details." },
      { status: 500 },
    );
  }
}
