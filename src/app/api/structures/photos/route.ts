import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { UUID_RE } from "@/lib/document-search";

export const runtime = "nodejs";

type PhotoWriteResult = RpcResult & {
  hasPhoto?: boolean;
  rosterId?: string | null;
};

type PhotoReadResult = RpcResult & {
  base64?: string | null;
  mime?: string | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function photoFailure(reason?: string): { reason: string; status: number } {
  if (reason === "forbidden") return { reason: "forbidden", status: 403 };
  if (reason === "not_found") return { reason: "not_found", status: 404 };
  return { reason: "photo_read_failed", status: 400 };
}

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const unitId = text(params.get("unitId"));
  const email = text(params.get("email"));

  if (!unitId || !email) {
    return NextResponse.json(
      { ok: false, message: "A unit and an email are required." },
      { status: 400 },
    );
  }

  if (!UUID_RE.test(unitId)) {
    return NextResponse.json(
      { ok: false, reason: "invalid_uuid", message: "That unit reference is not valid." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<PhotoReadResult>("show_structure_holder_photo", {
      p_session_token: token,
      p_unit_id: unitId,
      p_email: email,
    });
    if (!res.ok) {
      const failure = photoFailure(res.reason);
      return NextResponse.json(
        { ok: false, reason: failure.reason, message: messageFor(failure.reason) },
        { status: failure.status },
      );
    }
    if (!res.base64 || !res.mime) {
      return NextResponse.json({ ok: true, base64: null, mime: null });
    }
    return NextResponse.json({ ok: true, base64: res.base64, mime: res.mime });
  } catch (error) {
    console.error("[structures:photo-read]", error);
    return NextResponse.json(
      { ok: false, reason: "photo_read_failed", message: "That photo could not be read. Please try again." },
      { status: 503 },
    );
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Something went wrong. Please try again." },
      { status: 400 },
    );
  }

  const unitId = text(body.unitId);
  const email = text(body.email);
  const photo = typeof body.photo === "string" ? body.photo : "";

  if (!unitId || !email || !photo) {
    return NextResponse.json(
      { ok: false, message: "A unit, an email and a photo are required." },
      { status: 400 },
    );
  }

  if (!UUID_RE.test(unitId)) {
    return NextResponse.json(
      { ok: false, reason: "invalid_uuid", message: "That unit reference is not valid." },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<PhotoWriteResult>("persist_structure_holder_photo", {
      p_session_token: token,
      p_unit_id: unitId,
      p_email: email,
      p_photo: photo,
    });
    return NextResponse.json(res);
  } catch (error) {
    console.error("[structures:photo-write]", error);
    return NextResponse.json(
      { ok: false, message: "We could not save that photo. Please try again." },
      { status: 500 },
    );
  }
}
