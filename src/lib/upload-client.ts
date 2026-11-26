"use client";

import { UPLOAD_CHUNK_BYTES } from "@/lib/documents";

export type UploadResult = {
  ok: boolean;
  storagePath?: string;
  reason?: string;
};

async function jsonPost(body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

export async function uploadFile(file: File, params: {
  target: "item" | "requirement" | "task_requirement" | "task_assignment" | "personal_request" | "resolution" | "accomplishment" | "budget";
  itemId?: string;
  requirementId?: string;
  taskId?: string;
  unitId?: string;
    eventId?: string;
    budgetKind?: "justification" | "receipt" | "usg_expense";
    nonce: string;
  version: number;
}): Promise<UploadResult> {
  // claim
  const claim = await jsonPost({
    action: "claim",
    target: params.target,
    fileName: file.name,
    sizeBytes: file.size,
    mimeType: file.type,
    itemId: params.itemId,
    requirementId: params.requirementId,
    taskId: params.taskId,
    unitId: params.unitId,
    eventId: params.eventId,
    budgetKind: params.budgetKind,
    nonce: params.nonce,
    version: params.version,
  });
  if (!claim.ok) return { ok: false, reason: (claim.reason as string) || "upload_failed" };
  const storagePath = claim.storagePath as string;

  // chunk upload
  let offset = 0;
  const buf = await file.arrayBuffer();
  while (offset < file.size) {
    const end = Math.min(offset + UPLOAD_CHUNK_BYTES, file.size);
    const chunk = buf.slice(offset, end);
    const res = await fetch("/api/uploads", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-smartgov-path": storagePath,
        "x-smartgov-offset": String(offset),
        "x-smartgov-total": String(file.size),
      },
      body: chunk,
    });
    const json = await res.json();
    if (!json.ok) return { ok: false, reason: (json.reason as string) || "upload_failed" };
    offset = (json.writtenBytes as number) ?? end;
  }

  // commit
  const commit = await jsonPost({ action: "commit", storagePath, actualBytes: file.size });
  if (!commit.ok) return { ok: false, reason: (commit.reason as string) || "upload_failed" };
  return { ok: true, storagePath };
}
