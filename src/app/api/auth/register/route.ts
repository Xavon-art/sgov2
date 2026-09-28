import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { setSessionCookie } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** Nodemailer and pgcrypto-adjacent work needs the Node runtime. */
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
 * Turns a finished setup flow into a login-capable account.
 *
 * The session is minted by re-running `login_account` with the same credentials
 * rather than by asking for a session on the new account id. There is
 * deliberately no RPC that takes an account id and returns a token, because
 * `anon` could call it for any id it could guess.
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

    const session = await callRpc<RpcResult>("login_account", {
      p_email: email,
      p_password: password,
    });

    if (session.ok && typeof session.token === "string") {
      await setSessionCookie(session.token);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[register]", error);
    return NextResponse.json(
      { ok: false, message: "We could not finish setting up the account." },
      { status: 500 },
    );
  }
}
