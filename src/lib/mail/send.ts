import { readFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outbound mail through Gmail SMTP.
 *
 * Only a handful of messages exist -- invitation, one-time passcode, welcome,
 * approval, password reset -- and all of them carry the SmartGov mark. The mark
 * is attached inline with a Content-ID rather than hot-linked, because Gmail and
 * Outlook routinely block remote images and would otherwise render a broken logo.
 */

let transporter: Transporter | null = null;

/** Content-ID the templates reference as `cid:smartgov-mark`. */
export const MARK_CID = "smartgov-mark";

/**
 * Gmail credentials, read under either the `GMAIL_*` names or the older
 * `SMTP_*` ones. The `GMAIL_*` pair is what the docs and `.env.example` lead
 * with; the `SMTP_*` fallback is kept so an existing deployment does not break
 * on the rename. `GMAIL_APP_PASSWORD` is a Google *app password*, not the
 * account password — Gmail rejects the account password over SMTP.
 */
function mailUser(): string | undefined {
  return process.env.GMAIL_USER || process.env.SMTP_USER;
}

function mailPassword(): string | undefined {
  return process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;
}

export function isMailConfigured(): boolean {
  return Boolean(mailUser() && mailPassword());
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const user = mailUser();
  const pass = mailPassword();

  if (!user || !pass) {
    throw new Error(
      "GMAIL_USER / GMAIL_APP_PASSWORD are not set. Add them to .env.local.",
    );
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });

  return transporter;
}

async function markAttachment() {
  const file = path.join(process.cwd(), "public", "email-mark.png");
  const content = await readFile(file);
  return {
    filename: "smartgov-mark.png",
    content,
    cid: MARK_CID,
    contentDisposition: "inline" as const,
  };
}

export type BrandedMail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type QueuedEmail = {
  id: string;
  to_address: string;
  subject: string;
  html: string | null;
  text_body: string | null;
};

export async function drainPendingEmails(
  limit = 25,
  passes = 4,
): Promise<{ sent: number; failed: number }> {
  const { callRpc } = await import("@/lib/auth/rpc");
  let sent = 0;
  let failed = 0;

  for (let pass = 0; pass < passes; pass += 1) {
    const pending = await callRpc<{
      ok: boolean;
      emails?: QueuedEmail[];
    }>("list_pending_emails", { p_limit: limit });
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

    if (pending.emails.length < limit) break;
  }

  return { sent, failed };
}

/**
 * Sends one branded message. Resolves only after Gmail accepts it, so callers
 * can treat a rejection as "not sent" and keep the record in a retryable state.
 */
export async function sendBranded(mail: BrandedMail): Promise<void> {
  if (!isMailConfigured()) {
    // Dev fallback: store the email in the outbox table so it is still
    // visible and verifiable without SMTP configured.
    const { callRpc } = await import("@/lib/auth/rpc");
    await callRpc("create_outbox_entry", {
      p_to: mail.to,
      p_subject: mail.subject,
      p_html: mail.html,
      p_text: mail.text,
    });
    return;
  }
  await getTransporter().sendMail({
    from: {
      name: process.env.MAIL_FROM_NAME ?? process.env.SMTP_FROM_NAME ?? "SmartGov",
      address:
        process.env.SMTP_FROM_EMAIL ?? (mailUser() as string),
    },
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    attachments: [await markAttachment()],
  });
}
