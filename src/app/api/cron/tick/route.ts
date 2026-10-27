import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { sendBranded } from "@/lib/mail/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QueuedEmail = {
  id: string;
  to_address: string;
  subject: string;
  html: string | null;
  text_body: string | null;
};

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

  let sent = 0;
  let failed = 0;

  for (let pass = 0; pass < 4; pass += 1) {
    const pending = await callRpc<RpcResult & { emails?: QueuedEmail[] }>("list_pending_emails", {
      p_limit: 25,
    });
    if (!pending.ok || !Array.isArray(pending.emails) || pending.emails.length === 0) break;

    for (const email of pending.emails) {
      try {
        await sendBranded({
          to: email.to_address,
          subject: email.subject,
          html: email.html ?? "",
          text: email.text_body ?? "",
        });
        await callRpc("mark_email_sent", { p_id: email.id, p_error: null });
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await callRpc("mark_email_sent", { p_id: email.id, p_error: message });
        failed += 1;
      }
    }

    if (pending.emails.length < 25) break;
  }

  return NextResponse.json({ ok: true, sweep, emailsSent: sent, emailsFailed: failed });
}
