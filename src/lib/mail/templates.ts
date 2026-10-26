import { MARK_CID, siteUrl } from "@/lib/mail/send";
import type { BrandedMail } from "@/lib/mail/send";

/**
 * The transactional emails, drawn from the same palette as the site:
 * navy ink, brass accents, ivory canvas, serif display.
 *
 * Email clients are hostile to modern layout, so these are table-based with
 * every style inlined and no external stylesheet, no SVG, and no web fonts.
 * Display type falls back to Georgia and body type to the system UI stack,
 * which is the closest a mail client can get to Fraunces and Inter.
 *
 * Every interpolated value runs through `esc()`. Organization and campus names
 * come from user input and are echoed into HTML, so this is a real injection
 * boundary rather than decoration.
 */

const INK = "#16324f";
const DEEP = "#0d2135";
const BRASS = "#c9a24b";
const BRASS_DEEP = "#a8822f";
const BRASS_SOFT = "#e7d3a1";
const CANVAS = "#fafaf7";
const BODY = "#46505c";
const MUTED = "#6f7783";
const HAIRLINE = "#e4e2dc";

const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shell(opts: {
  preheader: string;
  body: string;
  footnote: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>SmartGov</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};">
<span style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};">
  <tr>
    <td align="center" style="padding:28px 14px 44px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

        <tr>
          <td style="padding:0 4px 16px 4px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="44" valign="middle" style="width:44px;">
                  <img src="cid:${MARK_CID}" width="40" height="40" alt="SmartGov" style="display:block;width:40px;height:40px;border:0;border-radius:9px;">
                </td>
                <td valign="middle" style="font-family:${SERIF};font-size:22px;line-height:1;font-weight:700;color:${INK};letter-spacing:-0.01em;">
                  SmartGov
                </td>
                <td align="right" valign="middle" style="font-family:${SANS};font-size:10px;line-height:1.4;letter-spacing:0.16em;text-transform:uppercase;color:${BRASS_DEEP};font-weight:700;">
                  Student Government
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="background:#ffffff;border:1px solid ${HAIRLINE};border-radius:14px;">
            <tr>
              <td style="height:4px;line-height:0;font-size:0;background:linear-gradient(90deg,${INK} 0%,${BRASS} 62%,${BRASS_SOFT} 100%);border-radius:14px 14px 0 0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:34px 30px 12px 30px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${opts.body}
                </table>
              </td>
            </tr>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:22px 12px 0 12px;font-family:${SANS};font-size:12px;line-height:1.7;color:${MUTED};">
            ${esc(opts.footnote)}
            <br>
            <span style="color:#9aa1ab;">Sent by SmartGov on behalf of your student government.</span>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function eyebrow(label: string): string {
  return `<tr>
    <td style="padding:0 0 10px 0;font-family:${SANS};font-size:11px;line-height:1.4;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:${BRASS_DEEP};">
      ${esc(label)}
    </td>
  </tr>`;
}

function heading(text: string): string {
  return `<tr>
    <td style="padding:0 0 14px 0;font-family:${SERIF};font-size:29px;line-height:1.2;font-weight:700;color:${INK};letter-spacing:-0.015em;">
      ${esc(text)}
    </td>
  </tr>`;
}

function paragraph(text: string): string {
  return `<tr>
    <td style="padding:0 0 16px 0;font-family:${SANS};font-size:15px;line-height:1.68;color:${BODY};">
      ${esc(text)}
    </td>
  </tr>`;
}

function detail(label: string, value: string): string {
  return `<tr>
    <td width="112" valign="top" style="width:112px;padding:9px 0 9px 0;font-family:${SANS};font-size:12px;line-height:1.5;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;color:${MUTED};">
      ${esc(label)}
    </td>
    <td valign="top" style="padding:9px 0 9px 0;font-family:${SANS};font-size:15px;line-height:1.5;font-weight:600;color:${INK};">
      ${esc(value)}
    </td>
  </tr>`;
}

function detailsPanel(rows: string[]): string {
  return `<tr>
    <td style="padding:4px 0 22px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};border:1px solid ${HAIRLINE};border-left:3px solid ${BRASS};border-radius:8px;">
        <tr>
          <td style="padding:14px 18px 6px 18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${rows.join("")}
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function button(href: string, label: string): string {
  return `<tr>
    <td style="padding:2px 0 20px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center" bgcolor="${INK}" style="background:${INK};border-radius:9px;">
            <a href="${esc(href)}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:15px;line-height:1;font-weight:700;letter-spacing:0.01em;color:${CANVAS};text-decoration:none;border-radius:9px;">
              ${esc(label)}
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

/** The visible link, kept because mail clients and gateways strip bare URLs. */
function fallbackLink(url: string): string {
  return `<tr>
    <td style="padding:0 0 20px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED};word-break:break-all;">
      If the button does not work, paste this into your browser:<br>
      <a href="${esc(url)}" style="color:${BRASS_DEEP};text-decoration:underline;">${esc(url)}</a>
    </td>
  </tr>`;
}

function signOff(): string {
  return `<tr>
    <td style="padding:4px 0 6px 0;font-family:${SANS};font-size:14px;line-height:1.7;color:${BODY};">
      Welcome aboard,<br>
      <span style="font-weight:700;color:${INK};">The SmartGov team</span>
    </td>
  </tr>`;
}

/**
 * The navy code block shared by the passcode and password-reset emails. The
 * wide tracking and the deep background are what make a six-digit code
 * unmistakable in a crowded inbox.
 */
function codePanel(code: string, caption: string): string {
  return `<tr>
    <td style="padding:0 0 20px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${DEEP};border-radius:10px;">
        <tr>
          <td align="center" style="padding:22px 16px 24px 16px;">
            <div style="font-family:${SANS};font-size:34px;line-height:1;letter-spacing:0.34em;font-weight:700;color:#ffffff;text-indent:0.34em;">
              ${esc(code)}
            </div>
            <div style="padding:12px 0 0 0;font-family:${SANS};font-size:12px;line-height:1.5;letter-spacing:0.08em;color:${BRASS_SOFT};">
              ${esc(caption)}
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

// ---------------------------------------------------------------- invitation

export function inviteEmail(opts: {
  to: string;
  inviter: string;
  organizationName: string;
  universityName: string;
  campusName: string;
  token: string;
}): BrandedMail {
  const url = `${siteUrl()}/invite/${opts.token}`;
  const where = opts.campusName || opts.organizationName;

  const html = shell({
    preheader: `You have been invited to ${opts.organizationName} on SmartGov.`,
    body: [
      eyebrow("You are invited"),
      heading("You've been added to a student government"),
      paragraph(
        `${opts.inviter} has invited you to join ${opts.organizationName} on SmartGov, the system that keeps student council records, budgets, and resolutions in one place.`,
      ),
      detailsPanel([
        detail("Campus", where),
        detail("Organization", opts.organizationName),
        opts.universityName ? detail("University", opts.universityName) : "",
      ]),
      paragraph(
        "Set your password and verify your email to activate the account. The link is valid for 14 days.",
      ),
      button(url, "Activate your account"),
      fallbackLink(url),
    ].join(""),
    footnote:
      "You are receiving this because a student government officer added your email address.",
  });

  const text = [
    "YOU ARE INVITED",
    "",
    `${opts.inviter} has invited you to join ${opts.organizationName} on SmartGov.`,
    "",
    `Campus: ${where}`,
    `Organization: ${opts.organizationName}`,
    opts.universityName ? `University: ${opts.universityName}` : "",
    "",
    "Activate your account (valid 14 days):",
    url,
    "",
    "Set your password, then verify the code we email you.",
  ]
    .filter(Boolean)
    .join("\n");

  return { to: opts.to, subject: `You're invited to ${opts.organizationName} — SmartGov`, html, text };
}

// ---------------------------------------------------------------- activation

export function activationEmail(opts: {
  to: string;
  organizationName: string;
  campusName: string;
  token: string;
}): BrandedMail {
  const url = `${siteUrl()}/activate?token=${opts.token}`;
  const where = opts.campusName || opts.organizationName;

  const html = shell({
    preheader: `Your SmartGov account for ${where} is ready to activate.`,
    body: [
      eyebrow("Almost there"),
      heading("Activate your USG account"),
      paragraph(
        `Your workspace for ${where} is set up. Click the button below to activate your account and open your dashboard — it signs you in as your student government's administrator.`,
      ),
      detailsPanel([
        detail("Workspace", where),
        opts.organizationName && opts.organizationName !== where
          ? detail("Organization", opts.organizationName)
          : "",
        detail("Scope", "Federated student government"),
      ]),
      button(url, "Activate my USG account"),
      fallbackLink(url),
      paragraph(
        "The link is unique to your registration — using it proves the address is yours. If you did not register on SmartGov, you can ignore this email.",
      ),
    ].join(""),
    footnote: "This link activates your account and opens your dashboard.",
  });

  const text = [
    "ACTIVATE YOUR USG ACCOUNT",
    "",
    `Your SmartGov workspace for ${where} is ready.`,
    "",
    `Workspace: ${where}`,
    opts.organizationName && opts.organizationName !== where
      ? `Organization: ${opts.organizationName}`
      : "",
    "Scope: Federated student government",
    "",
    "Click or paste this into your browser to activate and open your dashboard:",
    url,
    "",
    "If you did not register on SmartGov, ignore this email.",
  ]
    .filter(Boolean)
    .join("\n");

  return { to: opts.to, subject: `Activate your USG account — SmartGov`, html, text };
}

// ---------------------------------------------------------------- passcode

export function otpEmail(opts: {
  to: string;
  code: string;
  organizationName: string;
  campusName: string;
  minutes: number;
}): BrandedMail {
  const html = shell({
    preheader: `${opts.code} is your SmartGov verification code.`,
    body: [
      eyebrow("Verification code"),
      heading("Confirm it's you"),
      paragraph(
        `Enter this code to finish activating your SmartGov account for ${opts.organizationName}.`,
      ),
      codePanel(opts.code, `Expires in ${opts.minutes} minutes`),
      paragraph(
        `If you did not request this, you can ignore this email — the code is useless without the password you just set.`,
      ),
    ].join(""),
    footnote: "This code is personal to you. Never forward it.",
  });

  const text = [
    "VERIFICATION CODE",
    "",
    `Your SmartGov code is: ${opts.code}`,
    "",
    `It expires in ${opts.minutes} minutes.`,
    `Account: ${opts.campusName || opts.organizationName} — ${opts.organizationName}`,
  ].join("\n");

  return { to: opts.to, subject: `${opts.code} is your SmartGov code`, html, text };
}

// ---------------------------------------------------------------- password reset

export function passwordResetEmail(opts: {
  to: string;
  code: string;
  minutes: number;
}): BrandedMail {
  const html = shell({
    preheader: "Reset your SmartGov password with the code we just emailed you.",
    body: [
      eyebrow("Password reset"),
      heading("Set a new password"),
      paragraph(
        "We received a request to reset the password for your SmartGov account. Enter this code to confirm it is really you.",
      ),
      codePanel(opts.code, `Expires in ${opts.minutes} minutes`),
      paragraph(
        "If you did not ask to change your password, ignore this email. Only the person reading this inbox can use the code, and your password stays exactly as it is.",
      ),
    ].join(""),
    footnote: "This code is personal to you. Never forward it.",
  });

  const text = [
    "PASSWORD RESET",
    "",
    `Your SmartGov reset code is: ${opts.code}`,
    "",
    `It expires in ${opts.minutes} minutes.`,
    "Enter it on the sign-in page to set a new password.",
    "If this was not you, ignore this email.",
  ].join("\n");

  return { to: opts.to, subject: `Reset your SmartGov password`, html, text };
}

// ---------------------------------------------------------------- deactivation

/**
 * Tells a unit seat that the USG has scheduled a temporary deactivation.
 *
 * Deliberately not phrased as a punishment. The window is a scheduling decision
 * the USG made, and the letter's job is to say when the desk goes quiet, when it
 * comes back, and to whom to reply -- not to argue the case. A window with no end
 * date is stated as open-ended, because that is what it is.
 */
export function deactivationEmail(opts: {
  to: string;
  unitName: string;
  startsAt: string;
  endsAt: string | null;
  reason: string;
  actingOfficer: string;
}): BrandedMail {
  const url = `${siteUrl()}/login`;
  const starts = opts.startsAt.slice(0, 10);
  const ends = opts.endsAt ? opts.endsAt.slice(0, 10) : null;
  const window = ends ? `${starts} to ${ends}` : `from ${starts} until further notice`;

  const html = shell({
    preheader: `Your SmartGov access for ${opts.unitName} is paused ${window}.`,
    body: [
      eyebrow("Access paused"),
      heading("A temporary deactivation is scheduled"),
      paragraph(
        `${opts.actingOfficer} has scheduled a temporary deactivation for ${opts.unitName} on SmartGov. While the window is open, sign-in for this account is paused; everything it has already submitted stays on record and untouched.`,
      ),
      detailsPanel([
        detail("Unit", opts.unitName),
        detail("Starts", starts),
        detail("Ends", ends ?? "Open-ended"),
        opts.reason ? detail("Note", opts.reason) : "",
      ].filter(Boolean)),
      paragraph(
        "When the window closes, the account comes back on its own — nothing has to be re-requested. If this is unexpected, reply to your USG office rather than to this message.",
      ),
      button(url, "Open SmartGov"),
      fallbackLink(url),
    ].join(""),
    footnote: "You are receiving this because you hold a seat in this student government.",
  });

  const text = [
    "TEMPORARY DEACTIVATION SCHEDULED",
    "",
    `${opts.actingOfficer} has scheduled a temporary deactivation for ${opts.unitName}.`,
    "",
    `Unit: ${opts.unitName}`,
    `Starts: ${starts}`,
    `Ends: ${ends ?? "Open-ended"}`,
    opts.reason ? `Note: ${opts.reason}` : "",
    "",
    "Sign-in for this account is paused while the window is open. It returns on its own when the window closes.",
    "",
    url,
  ]
    .filter(Boolean)
    .join("\n");

  return { to: opts.to, subject: `${opts.unitName} is paused on SmartGov`, html, text };
}

// ---------------------------------------------------------------- welcome

export function welcomeEmail(opts: {
  to: string;
  displayName: string;
  organizationName: string;
  universityName: string;
  campusName: string;
  accountKind: "usg" | "central";
}): BrandedMail {
  const url = `${siteUrl()}/login`;
  const scope =
    opts.accountKind === "usg"
      ? "University Student Government"
      : "Centralized student government office";

  const html = shell({
    preheader: `Your SmartGov account for ${opts.campusName || opts.organizationName} is active.`,
    body: [
      eyebrow("Account active"),
      heading("Welcome to SmartGov"),
      paragraph(
        `Your account is live, ${opts.displayName}. You now have a workspace for your student government, with your records and responsibilities in one place.`,
      ),
      `<tr>
        <td style="padding:0 0 20px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};border:1px solid ${HAIRLINE};border-radius:10px;">
            <tr>
              <td width="72" valign="top" style="width:72px;padding:18px 0 18px 18px;">
                <img src="cid:${MARK_CID}" width="52" height="52" alt="${esc(opts.campusName || opts.organizationName)}" style="display:block;width:52px;height:52px;border:0;border-radius:12px;">
              </td>
              <td valign="top" style="padding:18px 18px 18px 0;">
                <div style="font-family:${SERIF};font-size:19px;line-height:1.3;font-weight:700;color:${INK};">
                  ${esc(opts.campusName || opts.organizationName)}
                </div>
                <div style="padding:5px 0 0 0;font-family:${SANS};font-size:13px;line-height:1.55;color:${BODY};">
                  ${esc(scope)}${opts.organizationName ? ` under ${esc(opts.organizationName)}` : ""}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`,
      detailsPanel(
        [
          detail("Email", opts.to),
          opts.universityName ? detail("University", opts.universityName) : "",
          detail("Workspace", scope),
        ].filter(Boolean),
      ),
      button(url, "Sign in to SmartGov"),
      fallbackLink(url),
      signOff(),
    ].join(""),
    footnote: "Your account is active. You can sign in with your email and password.",
  });

  const text = [
    "WELCOME TO SMARTGOV",
    "",
    `Your account is live, ${opts.displayName}.`,
    "",
    `Campus: ${opts.campusName || opts.organizationName}`,
    `Under: ${opts.organizationName}`,
    `University: ${opts.universityName}`,
    `Workspace: ${scope}`,
    "",
    "Sign in:",
    url,
  ]
    .filter(Boolean)
    .join("\n");

  return { to: opts.to, subject: `Your SmartGov account is active`, html, text };
}

// ---------------------------------------------------------------- officer deactivation

export function officerDeactivationEmail(opts: {
  to: string;
  displayName: string | null;
  organizationName: string;
  reason: string | null;
  replacementEmail: string | null;
}): BrandedMail {
  const who = opts.displayName ? opts.displayName : opts.to;
  const hasReplacement = Boolean(opts.replacementEmail);

  const html = shell({
    preheader: `Your access to ${opts.organizationName} on SmartGov has been deactivated.`,
    body: [
      eyebrow("Access deactivated"),
      heading("Your SmartGov access has been turned off"),
      paragraph(
        `Hi ${who}, the USG administrator has deactivated your officer account for ${opts.organizationName}. You can no longer sign in, and any pending invitation for your seat has been cancelled.`,
      ),
      opts.reason
        ? detailsPanel([detail("Reason", opts.reason)])
        : "",
      hasReplacement
        ? paragraph(
            `A handover link has been sent to ${opts.replacementEmail} so a successor can take over your seat, memberships, and records. Nothing you authored is lost — it stays with the organization under the new account.`,
          )
        : paragraph(
            "Your seat is now vacant. The administrator will assign a new officer when ready. Nothing you authored is lost — it stays with the organization.",
          ),
      paragraph(
        "If you believe this was a mistake, contact the USG administrator who runs your student government.",
      ),
      signOff(),
    ]
      .filter(Boolean)
      .join(""),
    footnote:
      "You are receiving this because an officer account in your name was deactivated.",
  });

  const text = [
    "ACCESS DEACTIVATED",
    "",
    `Hi ${who},`,
    "",
    `The USG administrator has deactivated your officer account for ${opts.organizationName}.`,
    "You can no longer sign in, and any pending invitation for your seat has been cancelled.",
    "",
    opts.reason ? `Reason: ${opts.reason}` : "",
    "",
    hasReplacement
      ? `A handover link has been sent to ${opts.replacementEmail} so a successor can take over your seat, memberships, and records. Nothing you authored is lost.`
      : "Your seat is now vacant. Nothing you authored is lost.",
    "",
    "If you believe this was a mistake, contact the USG administrator.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    to: opts.to,
    subject: `Your SmartGov access for ${opts.organizationName} has been deactivated`,
    html,
    text,
  };
}
