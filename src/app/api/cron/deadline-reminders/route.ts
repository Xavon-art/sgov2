import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { drainPendingEmails } from "@/lib/mail/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReminderResult = RpcResult & Record<string, unknown>;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }
  }

  const reminders = await callRpc<ReminderResult>("send_deadline_reminders", {});
  if (!reminders.ok) {
    return NextResponse.json({ ok: false, message: "Deadline reminders failed." }, { status: 500 });
  }

  const { sent, failed } = await drainPendingEmails();

  return NextResponse.json({
    ok: true,
    reminders,
    emailsSent: sent,
    emailsFailed: failed,
  });
}
