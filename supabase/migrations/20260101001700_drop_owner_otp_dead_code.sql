-- ------------------------------------------------------------------ drop owner OTP
--
-- Owner registration moved from a six-digit emailed passcode to an activation
-- link in 20260101001600. The passcode path was left behind, and it can no
-- longer succeed:
--
--   create_owner_account  writes verify_token_hash and leaves otp_hash NULL
--   set_owner_otp         is the only writer of otp_hash, and nothing calls it
--   verify_owner_otp      reads otp_hash and returns 'otp_expired' on NULL
--
-- So /api/auth/verify-owner returned HTTP 400 "That code has expired" for every
-- input, including a correct one. The UI already had no code entry, so this was
-- unreachable dead code rather than a user-facing break.
--
-- Dropping it removes the last reachable writer of the owner OTP columns, so
-- otp_hash / otp_expires_at / otp_attempts on smartgov.accounts now only ever
-- hold NULL for owner accounts. They are left in place because the invite and
-- password-reset flows are NOT in this migration's scope and are unrelated.
--
-- Deliberately untouched:
--   public.verify_otp / public.resend_invite_otp / public.set_otp  -- invite flow
--   otpCode() / hmacOtp()                                          -- still used
--   RPC_MESSAGES otp_expired / otp_mismatch / too_many_attempts     -- shared keys

drop function if exists public.set_owner_otp(text, text, integer);
drop function if exists public.verify_owner_otp(text, text);
drop function if exists public.owner_registration_probe(text);

drop function if exists smartgov.set_owner_otp(text, text, integer);
drop function if exists smartgov.verify_owner_otp(text, text);
drop function if exists smartgov.owner_registration_probe(text);
