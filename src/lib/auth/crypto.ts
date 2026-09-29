import { createHmac, randomBytes, randomInt } from "node:crypto";

/**
 * Server-only helpers for the values that must never be stored in plaintext.
 *
 * Passwords are hashed by Postgres (`pgcrypto`'s bcrypt). This module covers the
 * other two secrets: the six-digit one-time passcode and the session/invite
 * tokens. Both are hashed before they cross the wire to the database, so a dump
 * of `smartgov.accounts` or `smartgov.sessions` cannot be replayed.
 */

/**
 * The pepper is a server-side secret that makes the stored OTP digest useless on
 * its own. It is required rather than defaulted: silently falling back to an
 * unkeyed digest would let anyone who reads the database brute-force all
 * million codes for an account in seconds.
 */
function pepper(): string {
  const value = process.env.AUTH_PEPPER;
  if (!value) {
    throw new Error(
      "AUTH_PEPPER is not set. Add it to .env.local before using invites or OTP.",
    );
  }
  return value;
}

/**
 * A uniform six-digit code.
 *
 * `randomInt` is a CSPRNG and already rejects out-of-range draws, so the code is
 * uniform over exactly one million values — no modulo bias to correct for.
 */
export function otpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** HMAC-SHA256 of an OTP, which is what actually gets stored. */
export function hmacOtp(code: string): string {
  return createHmac("sha256", pepper()).update(code).digest("hex");
}

/**
 * Raw token for a session or an invitation link. Only its SHA-256 (computed
 * inside Postgres) is persisted, so this value exists only in the response and
 * in the email.
 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
