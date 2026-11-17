import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { drainPendingEmails } from "@/lib/mail/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The scheduler tick.
 *
 * 1. Materialise every timed transition (task auto-close, request expiry,
 *    survey close, deactivation start/end).
 * 2. Drain the email queue those transitions wrote to.
 *
 * Called by Vercel Cron once a day, and opportunistically by the app through
 * `maybeSweep()`. Safe to call at any frequency: the sweep is idempotent and
 * an email that was already sent is no longer in the pending list.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
  }

  const sweep = await callRpc<RpcResult & Record<string, unknown>>("sweep", {});
  if (!sweep.ok) {
    return NextResponse.json({ ok: false, message: "Sweep failed." }, { status: 500 });
  }

  const { sent, failed } = await drainPendingEmails();

  return NextResponse.json({ ok: true, sweep, emailsSent: sent, emailsFailed: failed });
}
