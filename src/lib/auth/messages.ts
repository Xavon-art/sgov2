/**
 * Maps the stable `reason` codes coming back from the `smartgov` functions to
 * wording that is safe to show a person.
 *
 * A raw database message would leak table and function names, so routes never
 * surface `reason` directly. Anything unmapped falls back to a generic line
 * rather than echoing the original.
 */
const RPC_MESSAGES: Record<string, string> = {
  invalid_credentials: "Email or password is incorrect.",
  account_pending: "Finish activating your account using the link we emailed you.",
  unauthenticated: "Your session has expired. Please sign in again.",
  forbidden: "Your account is not allowed to do that.",
  no_organization: "This workspace is not linked to an organization yet.",
  no_unit: "Your organization has no campus or department yet.",
  invalid_email: "Enter a valid email address.",
  weak_password: "Use a password of at least 8 characters.",
  missing_name: "Enter your full name.",
  email_taken: "That email already has an account.",
  already_registered: "That email already has an account. Sign in instead.",
  invalid_invite:
    "This invitation is no longer valid. Ask the officer who invited you to send a new one.",
  otp_expired: "That code has expired. Request a new one.",
  otp_mismatch: "That code is not correct.",
  too_many_attempts: "Too many wrong attempts. Ask your officer for a new invitation.",
  verify_failed: "We could not verify that code. Please try again.",
  invite_activated: "That invitation has already been accepted.",
  // Only `resend_invite` can return this: revoke is idempotent on a revoked row.
  invite_cancelled: "That invitation was cancelled.",
  retry: "That did not save. Please try again in a moment.",
  invalid_organization: "That organization could not be found.",
  not_organization_founder:
    "This sign-in email is not the officer who created the organization. Use the address you set up the organization with.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  invalid_request: "Something went wrong. Please try again.",
  database_unavailable: "The database is not configured, so this cannot run yet.",
  invalid_label: "Give the position a name before adding it.",
  duplicate_label: "Your organization already has a position with that name.",
  not_found: "That unit or position is not part of your organization.",
  seat_occupied: "This seat still has a holder — release them first.",
  seat_not_enabled: "This position is not enabled for that unit yet.",
  invalid_name: "Give the campus or department a name before adding it.",
  invalid_type: "That unit type is not one you can add here.",
  duplicate_unit_name: "Your organization already has a campus or department by that name.",
  unitary_model:
    "Only a decentralized student government can add campuses or departments. Your organization's structure is fixed.",
  no_program:
    "You must attach this submission to a program, or the owner has to add what office will accept it.",
  no_proposal: "That submission no longer exists.",
  not_in_unit:
    "Your account is not seated in a candidate unit yet, so you cannot submit for one.",
  incomplete_submission:
    "The owner has not finalized the template for this program yet, so no standalone submission is accepted. Come back once the items are set.",
  unsupported_file_type:
    "That file type is not accepted here. Choose one of the allowed types for this item.",
  file_too_large: "That file is larger than the 10 MB limit for one item.",
  not_returned:
    "Only a submission that was returned can be resubmitted with changes.",
  already_reviewed:
    "That submission has already been acted on, so it can no longer be reviewed.",
};

export function messageFor(reason?: string): string {
  if (!reason) return "Something went wrong. Please try again.";
  return RPC_MESSAGES[reason] ?? "Something went wrong. Please try again.";
}

/** Hides all but the first character of an address in UI and logs. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "your email";
  return `${email.slice(0, 1)}${"*".repeat(Math.min(6, at - 1))}${email.slice(at)}`;
}
