import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_BYTES,
  createSignedUploadUrl,
  sanitizeFileName,
} from "@/lib/storage";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MatchItem = {
  itemKind: "file" | "link";
  allowedExtensions: string[];
};

type MatchResult = RpcResult & {
  item?: MatchItem;
};

type ProgramsResult = RpcResult & {
  organizationId?: string;
};

function statusForReason(reason?: string): number {
  if (reason === "unauthenticated") return 401;
  if (reason === "rate_limited") return 429;
  if (reason === "forbidden") return 403;
  return 400;
}

/*
 * The caller's organization is not in the body; it is not needed to build the
 * path because the RPC calls already scoped the caller to their own org. The
 * path shape is the exact one create_proposal/submit_revision re-derive, so a
 * client cannot inject a foreign path.
 */
async function callerOrganizationId(token: string): Promise<string | null> {
  const res = await callRpc<ProgramsResult>("list_programs", {
    p_session_token: token,
  });
  return res.ok && res.organizationId ? res.organizationId : null;
}

/**
 * Presign a storage slot for one requirement item's document.
 *
 * The route validates the item through the scoped `match_requirement_item`
 * RPC, the extension against the item's own allowlist, and the size against the
 * bucket cap -- then mints a signed upload URL under the caller's own org
 * folder. The browser PUTs directly to Storage; the DB never sees the bytes.
 * This is a JSON endpoint by design: the UI needs the URL and the storage path
 * back separately to record the submission.
 */
export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const ip = clientIp(req);
  const limited = rateLimit(`upload:${ip}`, 40, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited"), retryAfterSeconds: limited.retryAfterSeconds },
      { status: 429 },
    );
  }

  let body: {
    uuid: string;
    itemId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    version?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Something went wrong. Please try again." },
      { status: 400 },
    );
  }

  const version = Number.isInteger(body.version) && body.version! >= 1 ? body.version! : 1;
  if (!UUID_RE.test(body.uuid ?? "") || !UUID_RE.test(body.itemId ?? "")) {
    return NextResponse.json({ ok: false, message: messageFor("invalid_request") }, { status: 400 });
  }
  if (typeof body.sizeBytes !== "number" || body.sizeBytes <= 0 || body.sizeBytes > MAX_FILE_BYTES) {
    return NextResponse.json({ ok: false, message: messageFor("file_too_large") }, { status: 400 });
  }

  try {
    const match = await callRpc<MatchResult>("match_requirement_item", {
      p_session_token: token,
      p_item_id: body.itemId,
    });
    if (!match.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(match.reason) },
        { status: statusForReason(match.reason) },
      );
    }
    if (match.item?.itemKind !== "file") {
      return NextResponse.json({ ok: false, message: messageFor("invalid_request") }, { status: 400 });
    }

    const ext = (body.fileName.split(".").pop() ?? "").toLowerCase();
    const allowed: readonly string[] = match.item.allowedExtensions.length
      ? match.item.allowedExtensions
      : ALLOWED_EXTENSIONS;
    if (!allowed.includes(ext)) {
      return NextResponse.json({ ok: false, message: messageFor("unsupported_file_type") }, { status: 400 });
    }

    const orgId = await callerOrganizationId(token);
    if (!orgId) {
      return NextResponse.json({ ok: false, message: messageFor("unauthenticated") }, { status: 401 });
    }

    const name = sanitizeFileName(body.fileName);
    if (!name) {
      return NextResponse.json({ ok: false, message: messageFor("invalid_request") }, { status: 400 });
    }

    const storagePath = `${orgId}/proposals/${body.uuid}/v${version}/${body.itemId}/${name}`;

    const { signedUrl, token: uploadToken } = await createSignedUploadUrl(storagePath);

    return NextResponse.json({ ok: true, signedUrl, storagePath, uploadToken });
  } catch (error) {
    console.error("[uploads:presign]", error);
    return NextResponse.json(
      { ok: false, message: "We could not prepare that upload." },
      { status: 500 },
    );
  }
}