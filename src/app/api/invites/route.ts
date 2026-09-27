import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { sendBranded } from "@/lib/mail/send";
import { inviteEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

export type InviteRow = {
  id: string;
  email: string;
  campusName: string;
  unitType: string;
  status: "pending" | "activated" | "expired";
  invitedBy: string;
  createdAt: string;
  activatedAt: string | null;
  expiresAt: string;
};

/** Status feed for the dashboard: who is still pending, who has activated. */
export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<RpcResult & { invites?: InviteRow[] }>("list_invites", {
      p_session_token: token,
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 403 });
    }

    return NextResponse.json({ ok: true, invites: res.invites ?? [] });
  } catch (error) {
    console.error("[invites:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load your invitations." },
      { status: 500 },
    );
  }
}

/**
 * Invites one person by email and campus.
 *
 * The organization comes from the caller's own account inside the function, so
 * there is no way to invite into somebody else's workspace.
 *
 * A delivery failure is reported as its own outcome rather than an error: the
 * invitation row exists and shows up as pending, so the officer can see it and
 * resend instead of thinking nothing happened.
 */
export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { email?: string; campusName?: string; unitType?: string };
  try {
    body = (await req.json()) as { email?: string; campusName?: string; unitType?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const account = await currentAccount();

  try {
    const res = await callRpc<RpcResult>("create_invite", {
      p_session_token: token,
      p_email: body.email?.trim() ?? "",
      p_campus_name: body.campusName?.trim() ?? "",
      p_unit_type: body.unitType ?? "lsg",
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 400 });
    }

    const to = String(res.email);

    try {
      await sendBranded(
        inviteEmail({
          to,
          inviter: account?.displayName ?? "Your student government",
          organizationName: String(res.organizationName ?? ""),
          universityName: String(res.universityName ?? ""),
          campusName: String(res.campusName ?? ""),
          token: String(res.token),
        }),
      );
    } catch (mailError) {
      console.error("[invites:send]", mailError);
      return NextResponse.json({
        ok: false,
        delivered: false,
        code: "delivery_failed",
        email: to,
        message:
          "The invitation was recorded but the email could not be sent. Ask them to check spam, then resend.",
      });
    }

    return NextResponse.json({ ok: true, delivered: true, email: to });
  } catch (error) {
    console.error("[invites:create]", error);
    return NextResponse.json(
      { ok: false, message: "We could not create that invitation." },
      { status: 500 },
    );
  }
}
