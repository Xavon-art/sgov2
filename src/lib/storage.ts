/**
 * Server-only access to Supabase Storage for proposal documents.
 *
 * The publishable key in `@/lib/supabase` cannot touch the private bucket at
 * all; everything here runs on the service-role key, which is why this module
 * is never imported transitively from a client component ("use client"). The
 * browser only ever receives short-lived signed URLs, never this client.
 *
 * The 10 MiB cap lives in exactly two places: the bucket's `file_size_limit`
 * (enforced by Storage regardless of who mints the URL) and this constant,
 * which the presign route checks against the declared size before a signed
 * upload URL exists.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function serviceClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("proposal storage is not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export const PROPOSAL_BUCKET = "proposal-documents";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Extensions the USG may pick when an item asks for a file. */
export const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "jpg", "jpeg", "png", "webp", "gif", "zip",
] as const;

export function sanitizeFileName(fileName: string): string {
  const base = fileName.replace(/[\\/]/g, "-").replace(/[\u0000-\u001f]/g, "").trim();
  return base.length > 128 ? base.slice(0, 128) : base;
}

export async function createSignedUploadUrl(
  storagePath: string,
): Promise<{ signedUrl: string; token: string }> {
  const res = await serviceClient()
    .storage.from(PROPOSAL_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false });
  if (res.error || !res.data?.signedUrl) {
    throw new Error(res.error?.message ?? "could not mint an upload URL");
  }
  return { signedUrl: res.data.signedUrl, token: res.data.token };
}

export async function createSignedDownloadUrl(
  storagePath: string,
): Promise<string> {
  const res = await serviceClient()
    .storage.from(PROPOSAL_BUCKET)
    .createSignedUrl(storagePath, 5 * 60);
  if (res.error || !res.data?.signedUrl) {
    throw new Error(res.error?.message ?? "could not mint a download URL");
  }
  return res.data.signedUrl;
}

/** Verifies an already-uploaded object exists and matches the declared size. */
export async function objectSize(storagePath: string): Promise<number | null> {
  const res = await serviceClient().storage.from(PROPOSAL_BUCKET).info(storagePath);
  if (res.error || !res.data) return null;
  return Number(res.data.metadata?.size) || null;
}