import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { setSessionCookie } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendBranded } from "@/lib/mail/send";
import { welcomeEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

/**
 * Looser than the database's ten per address on purpose. The database counts
 * one mailbox; this counts one address, which behind a campus NAT is a whole
 * hall of students signing in at once, so the bar sits well above the real
 * volume and only stops a spray from a single host.
 */
const IP_LIMIT = 20;
const IP_WINDOW_MS = 5 * 60_000;

/**
 * Signs in with email and password.
 *
 * When this is an invited account's first successful sign-in, the welcome
 * letter is sent here -- after login, not after activation. The claim is
 * recorded only once the mail has been handed to the transport, so a transient
 * SMTP failure leaves the letter owed and the next sign-in retries it. That
 * ordering trades a rare duplicate for never losing a letter, which is the right
 * way round for a welcome note.
 *
 * A mail failure never blocks the sign-in: the caller is already authenticated
 * by this point and losing access because a welcome note did not send would be
 * worse than the missing note.
 */
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`login:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  try {
    const res = await callRpc<RpcResult>("login_account", {
      p_email: email,
      p_password: password,
    });

    if (!res.ok || typeof res.token !== "string") {
      // A pending account is not an error so much as a redirect: the caller has
      // the right password, they just have not proved the address yet. The
      // distinct `code` lets the sign-in page send them to the verification
      // step instead of showing a dead-end error.
      const pending = res.reason === "account_pending";
      return NextResponse.json(
        {
          ok: false,
          code: pending ? "account_pending" : undefined,
          message: messageFor(res.reason),
        },
        { status: pending ? 409 : 401 },
      );
    }

    await setSessionCookie(res.token);

    let welcomeSent = false;
    if (res.welcomeDue === true) {
      try {
        // Read the letter's context first without claiming it, so a transport
        // failure leaves the account unclaimed and the next sign-in retries.
        const ctx = await callRpc<RpcResult>("welcome_context", {
          p_session_token: res.token,
        });

        if (ctx.ok && ctx.due === true) {
          await sendBranded(
            welcomeEmail({
              to: String(ctx.email),
              displayName: String(ctx.displayName ?? ""),
              organizationName: String(ctx.organizationName ?? ""),
              universityName: String(ctx.universityName ?? ""),
              campusName: String(ctx.campusName ?? ""),
              accountKind: ctx.accountKind === "central" ? "central" : "usg",
            }),
          );

          // Only now is it safe to record the claim.
          await callRpc<RpcResult>("mark_welcome_sent", {
            p_session_token: res.token,
          });
          welcomeSent = true;
        }
      } catch (mailError) {
        console.error("[login:welcome]", mailError);
      }
    }

    return NextResponse.json({
      ok: true,
      welcomeSent,
      accountKind: (res.account as { accountKind?: string } | undefined)?.accountKind ?? "usg",
    });
  } catch (error) {
    console.error("[login]", error);
    return NextResponse.json(
      { ok: false, message: "We could not sign you in right now." },
      { status: 500 },
    );
  }
}
