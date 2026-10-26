import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendBranded } from "@/lib/mail/send";
import { deactivationEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

/**
 * The umbrella: every LSG under this USG, and the temporary deactivations the
 * owner has scheduled over them.
 *
 * `GET` returns the units with their member seats and any deactivation window,
 * straight from `list_umbrella`. `POST` schedules or lifts a window. Both are
 * owner-gated in the database, so nothing here has to re-derive authority.
 *
 * The email is a courtesy, not the mechanism: the window is enforced by
 * `authenticate` regardless of whether a letter was delivered. That is why a
 * delivery failure is reported as its own outcome rather than rolled back -- the
 * schedule is real and visible in the list either way, and the owner can tell
 * the unit by hand if the mail did not land.
 */
const IP_LIMIT = 30;
const IP_WINDOW_MS = 10 * 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ApiResponse = RpcResult & { units?: unknown[] };

export async function GET() {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  try {
    const res = await callRpc<ApiResponse>("list_umbrella", { p_session_token: token });

    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 403 });
    }

    return NextResponse.json({ ok: true, units: res.units ?? [] });
  } catch (error) {
    console.error("[umbrella:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load your umbrella." },
      { status: 500 },
    );
  }
}

type Body = {
  action?: "schedule" | "cancel";
  accountId?: string;
  startsOn?: string;
  endsOn?: string | null;
  reason?: string;
};

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: Body;
  try {
    body = ((await req.json()) ?? {}) as Body;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const accountId = typeof body.accountId === "string" ? body.accountId : "";
  if (!UUID_RE.test(accountId)) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`umbrella:write:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    if (body.action === "cancel") {
      const res = await callRpc<RpcResult>("cancel_deactivation", {
        p_session_token: token,
        p_account_id: accountId,
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: res.reason === "forbidden" ? 403 : 400 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action !== "schedule") {
      return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
    }

    const startsOn = typeof body.startsOn === "string" ? body.startsOn.trim() : "";
    const endsOn = typeof body.endsOn === "string" ? body.endsOn.trim() : "";

    if (!DATE_RE.test(startsOn)) {
      return NextResponse.json(
        { ok: false, reason: "missing_start", message: "Choose when the deactivation starts." },
        { status: 400 },
      );
    }

    if (endsOn !== "" && !DATE_RE.test(endsOn)) {
      return NextResponse.json(
        { ok: false, reason: "end_before_start", message: "That end date is not a valid date." },
        { status: 400 },
      );
    }

    const res = await callRpc<RpcResult & { startsAt?: string; endsAt?: string | null }>(
      "schedule_deactivation",
      {
        p_session_token: token,
        p_account_id: accountId,
        p_starts_on: startsOn,
        p_ends_on: endsOn === "" ? null : endsOn,
        p_reason: body.reason?.trim() ?? "",
      },
    );

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: res.reason === "forbidden" ? 403 : 400 },
      );
    }

    // Best-effort notice. The window is already in force in the database.
    try {
      const account = await currentAccount();
      const email = typeof (res as { email?: unknown }).email === "string"
        ? String((res as { email?: string }).email)
        : "";

      if (email) {
        await sendBranded(
          deactivationEmail({
            to: email,
            unitName: typeof (res as { unitName?: unknown }).unitName === "string"
              ? String((res as { unitName?: string }).unitName)
              : "your unit",
            startsAt: String(res.startsAt ?? startsOn),
            endsAt: res.endsAt ? String(res.endsAt) : null,
            reason: body.reason?.trim() ?? "",
            actingOfficer: account?.displayName ?? "Your USG",
          }),
        );
      }
    } catch (mailError) {
      console.error("[umbrella:mail]", mailError);
      return NextResponse.json({
        ok: true,
        delivered: false,
        message:
          "The deactivation is scheduled, but the notice email could not be sent. Tell the unit directly.",
      });
    }

    return NextResponse.json({ ok: true, delivered: true, startsAt: res.startsAt, endsAt: res.endsAt });
  } catch (error) {
    console.error("[umbrella:write]", error);
    return NextResponse.json(
      { ok: false, message: "We could not update that deactivation." },
      { status: 500 },
    );
  }
}
