/**
 * Shared shape of a proposal document, on both sides of the wire.
 *
 * The bytes live in a Postgres large object, not in Supabase Storage: this
 * deployment has no service-role key, so there is nothing that could mint a
 * signed bucket upload. That makes the database the only authority on what may be
 * stored, and it makes the route the only thing that moves bytes.
 *
 * Uploads therefore run claim -> chunk(s) -> commit rather than a single PUT. The
 * hosting edge caps one request body well under `MAX_FILE_BYTES`, and lowering the
 * product's file limit to whatever the edge allows would make the limit a property
 * of the deployment rather than of the product.
 */

/** The product's limit for one requirement item's document. Enforced in the DB. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * How much a single chunk request carries. Kept under the hosting edge's request
 * body limit with room for the JSON envelope, and rounded so the last chunk of a
 * large file is not the only awkward one.
 */
export const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;

/** Extensions the USG may pick when an item asks for a file. */
export const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "jpg", "jpeg", "png", "webp", "gif", "zip",
] as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Flattens anything a browser might put in a file name so it can only ever be a
 * single path segment. The database re-checks this, because a name that arrives
 * here has not been through the claim yet.
 */
export function sanitizeFileName(fileName: string): string {
  const base = fileName
    .replace(/[\\/]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return base.length > 128 ? base.slice(0, 128) : base;
}

/**
 * The storage path a document occupies. The database compares a submission's path
 * against exactly this string, so the route and the validator have to agree on it
 * character for character.
 *
 * The `<uuid>` segment is a client nonce, not the proposal id: `create_proposal`
 * mints the proposal id itself, after the document has to exist. The real link
 * between a document and its proposal is the `document_uploads.proposal_id`
 * column, filled in from the submission row.
 */
export function buildStoragePath(args: {
  organizationId: string;
  nonce: string;
  itemId: string;
  version: number;
  fileName: string;
}): string {
  const { organizationId, nonce, itemId, version, fileName } = args;
  return `${organizationId}/proposals/${nonce}/v${version}/${itemId}/${fileName}`;
}

/**
 * The storage path for a requirement-response document. The `reqs` segment is
 * what tells `claim_requirement_upload` this is not an item document; the rest
 * mirrors `buildStoragePath`, with the requirement id in place of the item id.
 * `version` is the next proposal version the LSG is about to mint when it
 * submits the response.
 */
export function buildRequirementStoragePath(args: {
  organizationId: string;
  nonce: string;
  requirementId: string;
  version: number;
  fileName: string;
}): string {
  const { organizationId, nonce, requirementId, version, fileName } = args;
  return `${organizationId}/proposals/${nonce}/reqs/v${version}/${requirementId}/${fileName}`;
}

export type UploadAction = "claim" | "chunk" | "commit" | "abort";

export type ClaimResponse = {
  ok: boolean;
  message?: string;
  /** Present on success; also present when resuming an existing reservation. */
  storagePath?: string;
  /** How many bytes the database already holds, so the client can resume. */
  writtenBytes?: number;
};

export type ChunkResponse = {
  ok: boolean;
  message?: string;
  writtenBytes?: number;
  complete?: boolean;
};