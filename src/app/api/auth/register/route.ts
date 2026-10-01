import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { maskEmail, messageFor } from "@/lib/auth/messages";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendBranded } from "@/lib/mail/send";
import { activationEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

/**
 * Account creation is a one-shot per person, so nothing legitimate comes close
 * to this. The database already caps it at five per address per hour; this sits
 * above that only to keep a spray across many addresses from ever reaching the
 * function in the first place.
 */
const IP_LIMIT = 8;
const IP_WINDOW_MS = 10 * 60_000;

type OwnerBody = {
  email?: string;
  password?: string;
  displayName?: string;
  accountKind?: "usg" | "central";
  organizationId?: string | null;
  universityName?: string;
  campusName?: string;
};

/**
 * Step 1 of the USG flow: create the registration, then mail an activation
 * link.
 *
 * The account is created in `pending` — the `verifyToken` returned here is the
 * only way to flip it to `active`. The email carries a button that calls
 * `/activate` with that token; `activate_owner` proves the registration belongs
 * to the mailbox, activates it, and mints the session in one step, so the
 * click lands the owner straight on their dashboard without a password entry.
 *
 * The token is never returned to anyone who does not have the email. If the
 * mail fails, the registration still exists, so the response says `canResend`
 * and the client offers a retry rather than a dead end.
 */
export async function POST(req: Request) {
  let body: OwnerBody;
  try {
    body = (await req.json()) as OwnerBody;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`register:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  try {
    const created = await callRpc<RpcResult>("create_owner_account", {
      p_payload: {
        email,
        password,
        displayName: body.displayName?.trim() ?? "",
        accountKind: body.accountKind === "central" ? "central" : "usg",
        organizationId: body.organizationId ?? null,
        universityName: body.universityName?.trim() ?? "",
        campusName: body.campusName?.trim() ?? "",
      },
    });

    if (!created.ok) {
      return NextResponse.json(
        { ok: false, message: messageFor(created.reason) },
        { status: 400 },
      );
    }

    const verifyToken = typeof created.verifyToken === "string" ? created.verifyToken : "";
    if (!verifyToken) {
      return NextResponse.json(
        { ok: false, message: "We could not start verification. Please try again." },
        { status: 500 },
      );
    }

    try {
      await sendBranded(
        activationEmail({
          to: email,
          organizationName: String(created.organizationName ?? ""),
          campusName: String(created.campusName ?? ""),
          token: verifyToken,
        }),
      );
    } catch (mailError) {
      console.error("[register:activation-email]", mailError);
      return NextResponse.json({
        ok: true,
        code: "email_failed",
        canResend: true,
        verifyToken,
        email: maskEmail(email),
        organizationName: String(created.organizationName ?? ""),
        message: "Your registration was saved but the email did not send. Use “Send the email again” below.",
      });
    }

    return NextResponse.json({
      ok: true,
      verifyToken,
      email: maskEmail(email),
      organizationName: String(created.organizationName ?? ""),
    });
  } catch (error) {
    console.error("[register]", error);
    return NextResponse.json(
      { ok: false, message: "We could not finish setting up the account." },
      { status: 500 },
    );
  }
}