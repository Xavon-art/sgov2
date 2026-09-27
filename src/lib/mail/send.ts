import { readFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outbound mail through Gmail SMTP.
 *
 * Only three messages exist -- invitation, one-time passcode, welcome -- and all
 * of them carry the SmartGov mark. The mark is attached inline with a
 * Content-ID rather than hot-linked, because Gmail and Outlook routinely block
 * remote images and would otherwise render a broken logo.
 */

let transporter: Transporter | null = null;

/** Content-ID the templates reference as `cid:smartgov-mark`. */
export const MARK_CID = "smartgov-mark";

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (!isMailConfigured()) {
    throw new Error("SMTP_USER / SMTP_PASS are not set. Add them to .env.local.");
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER as string,
      pass: process.env.SMTP_PASS as string,
    },
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

/**
 * Sends one branded message. Resolves only after Gmail accepts it, so callers
 * can treat a rejection as "not sent" and keep the record in a retryable state.
 */
export async function sendBranded(mail: BrandedMail): Promise<void> {
  await getTransporter().sendMail({
    from: {
      name: process.env.SMTP_FROM_NAME ?? "SmartGov",
      address: process.env.SMTP_FROM_EMAIL ?? (process.env.SMTP_USER as string),
    },
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    attachments: [await markAttachment()],
  });
}
