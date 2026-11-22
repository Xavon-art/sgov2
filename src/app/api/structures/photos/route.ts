import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";

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

  try {
    const res = await callRpc<PhotoReadResult>("show_structure_holder_photo", {
      p_session_token: token,
      p_unit_id: unitId,
      p_email: email,
    });
    return NextResponse.json(res);
  } catch (error) {
    console.error("[structures:photo-read]", error);
    return NextResponse.json({ ok: true, base64: null, mime: null });
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
