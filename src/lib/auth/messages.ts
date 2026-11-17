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
  replacement_registered:
    "That email already has an account. Choose a different replacement address.",
  confirm_mismatch:
    "The email you typed does not match the officer's address. Check it and try again.",
  weak_password: "Use a password of at least 8 characters.",
  missing_name: "Enter your full name.",
  email_taken: "That email already has an account.",
  already_registered: "That email already has an account. Sign in instead.",
  invalid_invite:
    "This invitation is no longer valid. Ask the officer who invited you to send a new one.",
  otp_expired: "That code has expired. Request a new one.",
  otp_required: "Verify your email before opening this survey.",
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
  account_not_found:
    "No active account with that email is in this organization. Check the address, or invite them first.",
  unknown_permission: "That permission does not exist.",
  owner_is_always_admin: "The USG Admin already has every permission.",
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
  already_uploaded:
    "A file is already attached to this item. Replace it to upload a different one.",
  missing_document:
    "That file has not finished uploading. Upload it again before submitting.",
  incomplete_upload: "That file has not finished uploading. Try uploading it again.",
  offset_mismatch:
    "The upload was out of step with the server. Wait a moment and upload it again.",
  size_mismatch: "That file did not finish uploading intact. Try it again.",
  not_returned:
    "Only a submission that was returned can be resubmitted with changes.",
  already_reviewed:
    "That submission has already been acted on, so it can no longer be reviewed.",
  invalid_title: "Give the request a name of at least 4 characters.",
  invalid_items:
    "Each line needs a name, a quantity above zero, and a unit cost of zero or more.",
  proposal_not_open:
    "That proposal has already been decided, so it cannot take a budget any more.",
  already_decided:
    "This request has already been decided. An approved or rejected request is final.",
  invalid_amount:
    "The approved amount has to be between zero and the amount that was requested.",
  remark_required:
    "Write a short note so the officer knows what to change.",
  past_deadline:
    "Pick a deadline from today onwards. A date already past cannot be worked to.",
  not_your_decision:
    "Only the USG office marks a task done. You can mark it in progress.",

  // ---- government structure (02960, 02980, 02990)
  //
  // Three of these are not failures but refusals of a specific edit, so the wording
  // has to say what to change rather than that something went wrong: a document with
  // two councils marked as the council is wrong in a way the officer can fix.
  duplicate_committee_key:
    "Two committees have the same key. Give each one a distinct key.",
  duplicate_position_key:
    "Two seats in the same committee have the same key. Give each one a distinct key.",
  duplicate_holder:
    "The same person is listed in more than one seat. Each officer may hold only one seat.",
  self_review:
    "You cannot review your own structure. Ask the USG office to decide it.",
  awaiting_review:
    "This structure is already with the USG office for review.",
  already_in_progress:
    "There is already an open revision of this structure. Finish that one first.",
  no_approved_structure:
    "There is no approved structure to renew yet.",

  // ---- federated dashboard remodel (03100-03104)
  display_name_invalid: "Use a name of 2 to 80 characters.",
  wrong_password: "That password is not correct.",
  same_password: "Choose a password you have not used for this account.",
  invalid_theme: "Choose Light, Dark, or Match the system.",
  invalid_accent: "Pick a colour as a six-digit hex value, like #16324f.",
  logo_too_large: "That logo is too large. Choose an image under about 150 KB.",
  missing_start: "Choose the date the deactivation starts.",
  end_before_start: "The end date has to be after the start date.",

  // ---- request module (03110-03115)
  //
  // The distinct-answer failures are worded as instructions, because each one
  // has exactly one fix and the person reading it can apply it directly.
  invalid_requirement: "Give every checklist item a name of at least 2 characters.",
  answer_required: "Attach a file or paste a link before saving your answer.",
  unaccepted_type:
    "That file type is not accepted for this item. Check the types the office listed.",
  note_required: "Write a short note so the unit knows what to change.",
  task_closed: "This task is closed, so it no longer takes answers or messages.",
  already_closed: "This task has already been closed.",
  already_done: "The office has already marked this unit done.",
  invalid_subject: "Give the request a subject of 4 to 160 characters.",
  invalid_cover_letter: "Write a cover letter of at least 10 characters.",
  message_empty: "Write something before sending.",
  message_too_long: "That message is too long. Keep it under 4000 characters.",
  invalid_reaction: "That reaction is not one of the four available.",
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
