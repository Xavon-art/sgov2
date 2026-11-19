import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

type Grant = {
  email: string;
  displayName: string | null;
  permission: string;
  grantedAt: string;
};

type ListPayload = RpcResult & { scope?: string; grants?: Grant[] };
type WritePayload = RpcResult & { email?: string; permission?: string };

/** Grantable permissions are widened by migration, not by input. */
const PERMISSIONS = new Set(["can_invite", "can_target_units"]);

function emailLooksValid(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Who holds a grantable permission.
 *
 * GET answers with the whole organization's grants to the USG Admin and with the
 * caller's own grants to anybody else -- which is what the LSG shell needs to say
 * "you can invite" without learning who else can.
 *
 * POST and DELETE refuse on anything but `account_scope = 'owner'`, and the RPC
 * repeats that check independently. The route check is there to give a fast 403
 * and a clear message; the SQL check is the one that actually holds.
 */
export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<ListPayload>("list_permissions", { p_session_token: token });
    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 401 });
    }
    return NextResponse.json({
      ok: true,
      scope: res.scope ?? "self",
      grants: res.grants ?? [],
    });
  } catch (error) {
    console.error("[permissions:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load permissions." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { email?: unknown; permission?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Send the email address as JSON." },
      { status: 400 },
    );
  }

  if (!emailLooksValid(body.email)) {
    return NextResponse.json(
      { ok: false, message: "Enter the officer's email address." },
      { status: 400 },
    );
  }

  if (!PERMISSIONS.has(String(body.permission))) {
    return NextResponse.json({ ok: false, message: "Unknown permission." }, { status: 400 });
  }

  try {
    const res = await callRpc<WritePayload>("grant_permission", {
      p_session_token: token,
      p_email: body.email.trim(),
      p_permission: body.permission,
    });

    if (!res.ok) {
      const status = res.reason === "forbidden" ? 403 : 400;
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status },
      );
    }

    return NextResponse.json({ ok: true, email: res.email, permission: res.permission });
  } catch (error) {
    console.error("[permissions:grant]", error);
    return NextResponse.json(
      { ok: false, message: "We could not grant that permission." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { email?: unknown; permission?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Send the email address as JSON." },
      { status: 400 },
    );
  }

  if (!emailLooksValid(body.email)) {
    return NextResponse.json(
      { ok: false, message: "Enter the officer's email address." },
      { status: 400 },
    );
  }

  if (!PERMISSIONS.has(String(body.permission))) {
    return NextResponse.json({ ok: false, message: "Unknown permission." }, { status: 400 });
  }

  try {
    const res = await callRpc<WritePayload>("revoke_permission", {
      p_session_token: token,
      p_email: body.email.trim(),
      p_permission: body.permission,
    });

    if (!res.ok) {
      const status = res.reason === "forbidden" ? 403 : 400;
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status },
      );
    }

    return NextResponse.json({ ok: true, email: res.email, permission: res.permission });
  } catch (error) {
    console.error("[permissions:revoke]", error);
    return NextResponse.json(
      { ok: false, message: "We could not remove that permission." },
      { status: 500 },
    );
  }
}