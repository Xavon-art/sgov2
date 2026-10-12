import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { messageFor } from "@/lib/auth/messages";
import {
  MAX_FILE_BYTES,
  UPLOAD_CHUNK_BYTES,
  UUID_RE,
  buildRequirementStoragePath,
  buildStoragePath,
  sanitizeFileName,
} from "@/lib/documents";

/**
 * Moves document bytes into the database, one chunk at a time.
 *
 * The bytes live in a Postgres large object rather than a storage bucket. There is
 * no service-role key on this deployment, so nothing in the app could mint a signed
 * upload; the database functions are the only writer, and they decide for
 * themselves whether a path belongs to the caller.
 *
 * Four actions, one route:
 *
 *   claim   reserve `<org>/proposals/<nonce>/v<n>/<item>/<name>`, and report
 *           `writtenBytes` so a client that dropped mid-upload picks up where it
 *           stopped instead of starting over;
 *   chunk   `POST` raw bytes with the offset they belong at. Raw rather than JSON
 *           because base64 would inflate the body by a third, and the body is the
 *           thing the hosting edge limits;
 *   commit  seal the object once every byte is written;
 *   abort   give the reservation back.
 *
 * `chunk` is identified by the presence of the offset header, so the caller does not
 * have to guess which content type it should be sending.
 */

function fail(reason: string, status = 400) {
  return NextResponse.json({ ok: false, message: messageFor(reason) }, { status });
}

function okWith(body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

/** Reads a byte count from a header or JSON field, refusing anything not an integer. */
function readCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

async function handleChunk(req: Request, token: string) {
  const path = req.headers.get("x-smartgov-path");
  const offsetHeader = req.headers.get("x-smartgov-offset");
  const totalHeader = req.headers.get("x-smartgov-total");

  if (!path || offsetHeader === null || !totalHeader) {
    return fail("invalid_request");
  }

  const offset = readCount(offsetHeader);
  const total = readCount(totalHeader);

  if (offset === null || total === null) return fail("invalid_request");
  if (total < 1 || total > MAX_FILE_BYTES) return fail("file_too_large");

  const bytes = Buffer.from(await req.arrayBuffer());

  if (bytes.length === 0) return fail("invalid_request");

  // The database refuses a chunk that overruns or skips, but it is cheaper to say so
  // here than to ship a body that was never going to be accepted.
  if (offset + bytes.length > total) return fail("invalid_request");
  if (bytes.length > UPLOAD_CHUNK_BYTES) return fail("file_too_large");

  const result = await callRpc<RpcResult & { writtenBytes?: number; complete?: boolean }>(
    "write_document_chunk",
    {
      p_session_token: token,
      p_storage_path: path,
      p_offset: offset,
      // PostgREST takes `bytea` as `\x`-prefixed hex or base64. Hex is already the
      // exact bytes and cannot be misread as a shorter string.
      p_chunk: "\\x" + bytes.toString("hex"),
      p_total_bytes: total,
    },
  );

  if (!result.ok) return fail(result.reason ?? "retry");

  return okWith({ writtenBytes: result.writtenBytes, complete: result.complete === true });
}

async function handleJson(req: Request, token: string) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail("invalid_request");
  }

  const action = body.action;
  const storagePath = typeof body.storagePath === "string" ? body.storagePath : null;

  if (action === "abort") {
    if (!storagePath) return fail("invalid_request");
    const result = await callRpc<RpcResult>("discard_document_upload", {
      p_session_token: token,
      p_storage_path: storagePath,
    });
    return okWith({ aborted: result.ok === true });
  }

  if (action === "claim") {
    const fileName = typeof body.fileName === "string" ? sanitizeFileName(body.fileName) : "";
    const sizeBytes = readCount(body.sizeBytes);
    const itemId = typeof body.itemId === "string" ? body.itemId : "";
    const requirementId = typeof body.requirementId === "string" ? body.requirementId : "";
    const nonce = typeof body.nonce === "string" ? body.nonce : "";
    const version = readCount(body.version);
    const target = body.target === "requirement" ? "requirement" : "item";

    if (!fileName || sizeBytes === null) return fail("invalid_request");
    if (sizeBytes < 1) return fail("invalid_request");
    if (sizeBytes > MAX_FILE_BYTES) return fail("file_too_large");
    if (!UUID_RE.test(nonce)) return fail("invalid_request");
    if (version === null || version < 1 || version > 50) return fail("invalid_request");

    // The path is built here, not sent by the browser. The browser supplies the
    // requirement item or the additional requirement, and the file, and nothing
    // else -- so there is no request shape in which a caller can choose the
    // organization segment. The nonce is there to keep two drafts from
    // colliding; it is deliberately not a proposal id, because the proposal is
    // created later and mints its own.
    const account = await currentAccount();
    if (!account?.organizationId) return fail("no_organization", 403);

    if (target === "requirement") {
      if (!UUID_RE.test(requirementId)) return fail("invalid_request");

      const storagePath = buildRequirementStoragePath({
        organizationId: account.organizationId,
        nonce,
        requirementId,
        version,
        fileName,
      });

      // A response document is reserved against a proposal_requirement rather
      // than a requirement_item; the RPC derives the org from the path prefix
      // and refuses a requirement that is not open on the caller's own
      // proposal. It has no resume semantics -- an in-flight claim is either
      // reused or refused.
      const result = await callRpc<RpcResult & { storagePath?: string }>(
        "claim_requirement_upload",
        {
          p_session_token: token,
          p_storage_path: storagePath,
          p_original_name: fileName,
          p_mime_type: typeof body.mimeType === "string" ? body.mimeType : "",
          p_size_bytes: sizeBytes,
        },
      );

      if (!result.ok) return fail(result.reason ?? "retry");

      return okWith({ storagePath: result.storagePath ?? storagePath, writtenBytes: 0 });
    }

    if (!UUID_RE.test(itemId)) return fail("invalid_request");

    const storagePath = buildStoragePath({
      organizationId: account.organizationId,
      nonce,
      itemId,
      version,
      fileName,
    });

    const result = await callRpc<
      RpcResult & { storagePath?: string; writtenBytes?: number; resumed?: boolean }
    >("claim_document_upload", {
      p_session_token: token,
      p_storage_path: storagePath,
      p_original_name: fileName,
      p_mime_type: typeof body.mimeType === "string" ? body.mimeType : "",
      p_size_bytes: sizeBytes,
    });

    if (!result.ok) return fail(result.reason ?? "retry");

    return okWith({
      storagePath: result.storagePath ?? storagePath,
      writtenBytes: result.writtenBytes ?? 0,
      resumed: result.resumed === true,
    });
  }

  if (action === "commit") {
    const actualBytes = readCount(body.actualBytes);
    if (!storagePath || actualBytes === null) return fail("invalid_request");

    const result = await callRpc<RpcResult>("confirm_document_upload", {
      p_session_token: token,
      p_storage_path: storagePath,
      p_actual_bytes: actualBytes,
    });

    if (!result.ok) return fail(result.reason ?? "retry");
    return okWith({ storagePath, actualBytes });
  }

  return fail("invalid_request");
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) return fail("unauthenticated", 401);

  try {
    return req.headers.get("x-smartgov-offset") !== null
      ? await handleChunk(req, token)
      : await handleJson(req, token);
  } catch (error) {
    console.error("document upload failed", error);
    return fail("retry", 503);
  }
}