import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { currentAccount } from "@/lib/auth/session";
import { sendBranded } from "@/lib/mail/send";
import { deactivationEmail } from "@/lib/mail/templates";
import { inviteEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

type DeactivatePayload = RpcResult & {
  accountId?: string;
  deactivatedEmail?: string;
  deactivatedName?: string | null;
  reason?: string | null;
  replacementEmail?: string | null;
  organizationName?: string;
  universityName?: string;
  campusName?: string;
  handoverToken?: string | null;
  expiresAt?: string | null;
};

function statusForReason(reason?: string): number {
  switch (reason) {
    case "unauthenticated":
      return 401;
    case "rate_limited":
      return 429;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    default:
      return 400;
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await ctx.params;

  let body: { reason?: unknown; replacementEmail?: unknown; startsAt?: unknown; endsAt?: unknown };
  try {
    body = (await request.json()) as { reason?: unknown; replacementEmail?: unknown };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const replacementEmail =
    typeof body.replacementEmail === "string" ? body.replacementEmail.trim() : "";
  const startsAt =
    typeof body.startsAt === "string" && body.startsAt ? body.startsAt : null;
  const endsAt =
    typeof body.endsAt === "string" && body.endsAt ? body.endsAt : null;

  try {
    const res = await callRpc<DeactivatePayload>("deactivate_officer", {
      p_session_token: token,
      p_account_id: id,
      p_reason: reason || null,
      p_replacement_email: replacementEmail,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(res.reason), reason: res.reason },
        { status: statusForReason(res.reason) },
      );
    }

    const owner = await currentAccount();
    const inviter = owner?.displayName ?? "USG administrator";

    // Send the deactivation notice to the departing officer (captured before
    // the handover swaps the row's email).
    if (res.deactivatedEmail) {
      try {
        await sendBranded(
          deactivationEmail({
            to: res.deactivatedEmail,
            displayName: res.deactivatedName ?? null,
            organizationName: res.organizationName ?? "",
            reason: res.reason ?? null,
            replacementEmail: res.replacementEmail ?? null,
          }),
        );
      } catch (mailError) {
        console.error("[officers:deactivate:notice-email]", mailError);
      }
    }

    // If a handover was minted, email the successor the activation link.
    if (res.handoverToken && res.replacementEmail) {
      try {
        await sendBranded(
          inviteEmail({
            to: res.replacementEmail,
            inviter,
            organizationName: res.organizationName ?? "",
            universityName: res.universityName ?? "",
            campusName: res.campusName ?? "",
            token: res.handoverToken,
          }),
        );
      } catch (mailError) {
        console.error("[officers:deactivate:handover-email]", mailError);
      }
    }

    return NextResponse.json({
      ok: true,
      accountId: res.accountId,
      deactivatedEmail: res.deactivatedEmail,
      replacementEmail: res.replacementEmail ?? null,
      handoverSent: Boolean(res.handoverToken),
    });
  } catch (error) {
    console.error("[officers:deactivate]", error);
    return NextResponse.json(
      { ok: false, message: messageFor("retry") },
      { status: 503 },
    );
  }
}