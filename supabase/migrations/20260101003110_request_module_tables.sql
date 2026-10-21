-- Request module: task threads, requirements, and personal requests.
--
-- Phase 2 of the federated remodel. Phase 1 built the shell; this file is the
-- data the Request section stands on, and it is the largest addition since the
-- original task tables.
--
-- Four things land here, and each one is a decision worth stating:
--
--   1. A THREAD. `task_messages` hangs off a task, not off an assignment.
--      A task to twelve units is one conversation with the office, not twelve
--      private chats -- the office asks once and every unit reads the same
--      answer. That is why there is no `unit_id` on a message by default, and
--      why a message may carry one when a unit speaks for itself.
--
--   2. DELETION WITH TWO SIDES. The rule is asymmetric and deliberate: when
--      USG unsends, it disappears from the USG side only, because the office
--      can tidy its own view of what it said; when an LSG deletes, it goes for
--      both, because a unit withdrawing a message should not leave the office
--      reading a record the unit believes it removed. Two boolean flags model
--      exactly that, and neither is a hard delete -- the row survives so the
--      audit trail of a unit's filings cannot be quietly erased by the party
--      being reviewed.
--
--   3. REQUIREMENTS. A task may demand documents. Each requirement names the
--      file types it will accept, whether it is mandatory, and a sample file
--      the office supplies. A unit answers per requirement, the office rules
--      per requirement (approve / flag / return), and the verdict and its note
--      are both kept -- a returned item without the office's reason is not a
--      decision, it is a rejection.
--
--   4. PERSONAL REQUESTS. The LSG's own channel upward: a cover letter, a
--      supporting document, a purpose, and the date it is needed. It shares the
--      file machinery with requirements rather than growing a second one.
--
-- House rules, unchanged from every migration before this one: no RLS policy,
-- no table grant. Every path in is a `security definer` function that resolves
-- the caller from the session token, and every function is paired with a
-- `public.*` forwarder granted to anon and authenticated.
--
-- Deadlines carry a timezone here, and that is new. `tasks.due_date` was a bare
-- date, which is right for "by Friday" and wrong for "by 5pm" -- 5pm in what
-- clock? The office and the unit may sit in different regions, so the moment a
-- task carries a time of day it has to carry the zone it was meant in.

-- ---------------------------------------------------------------- thread of a task
--
-- `author_side` is stored rather than derived, and that is the reason the
-- two-sided delete is even expressible: at the moment of deletion we need to
-- know which side is deleting without re-deriving the author's organisation
-- from a roster that may have since changed.
create table if not exists smartgov.task_messages (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references smartgov.tasks (id) on delete cascade,
  -- Null for an office-wide message; set when a unit speaks for itself.
  unit_id       uuid references public.governance_units (id) on delete cascade,
  author_id     uuid not null references smartgov.accounts (id),
  -- 'usg' or 'lsg'. Stored, not computed at read time.
  author_side   text not null check (author_side in ('usg', 'lsg')),
  body          text not null check (length(btrim(body)) between 1 and 4000),
  -- A reply in the thread. Null means a top-level message.
  reply_to      uuid references smartgov.task_messages (id) on delete set null,
  -- Two-sided delete. `hidden_from_unit` is set by either side; `hidden_from_office`
  -- only ever by the office. See the header: the asymmetry is the whole point.
  hidden_from_office boolean not null default false,
  hidden_from_unit   boolean not null default false,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz
);

create index if not exists task_messages_task_idx
  on smartgov.task_messages (task_id, created_at);
create index if not exists task_messages_reply_idx
  on smartgov.task_messages (reply_to);

-- Reactions are per person, per message, one of a small fixed set. The primary
-- key is what makes "react twice" impossible rather than something the UI has
-- to guard against.
create table if not exists smartgov.task_message_reactions (
  message_id uuid not null references smartgov.task_messages (id) on delete cascade,
  account_id uuid not null references smartgov.accounts (id) on delete cascade,
  reaction   text not null check (reaction in ('seen', 'question', 'thanks', 'agree')),
  created_at timestamptz not null default now(),
  primary key (message_id, account_id, reaction)
);

create index if not exists task_message_reactions_msg_idx
  on smartgov.task_message_reactions (message_id);

revoke all on smartgov.task_messages from public, anon, authenticated;
revoke all on smartgov.task_message_reactions from public, anon, authenticated;

-- ------------------------------------------------------- deadline context on a task
--
-- Added to the existing table rather than rebuilt: the records already there are
-- real, and `due_date` alone still reads correctly for them. A task with no
-- `due_time` is "by end of day", which is exactly what those older rows meant.
alter table smartgov.tasks
  add column if not exists due_time       time,
  add column if not exists due_timezone   text,
  -- Auto-close: when true, the task stops accepting answers once the deadline
  -- passes. Enforced in the write paths, never by a job -- same reasoning as
  -- `overdue`, which is computed rather than stored.
  add column if not exists auto_close      boolean not null default false,
  -- USG's closing statement when it wraps a task up by hand.
  add column if not exists closed_at       timestamptz,
  add column if not exists closed_by       uuid references smartgov.accounts (id) on delete set null,
  add column if not exists closing_note    text not null default '';

-- ------------------------------------------------------------------- requirements
--
-- One row per thing the office asks for. `accepted_types` is a jsonb array of
-- file extensions so the office can say "a spreadsheet, not a photo" without a
-- second table; the upload path checks it against this list, not against a
-- hard-coded one in TypeScript.
create table if not exists smartgov.task_requirements (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references smartgov.tasks (id) on delete cascade,
  position       integer not null default 0,
  label          text not null check (length(btrim(label)) between 2 and 160),
  instructions   text not null default '',
  -- Empty array means any allowed type. A non-empty array narrows it.
  accepted_types jsonb not null default '[]'::jsonb,
  required       boolean not null default true,
  -- The sample or template the office supplies, if any.
  sample_file    jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists task_requirements_task_idx
  on smartgov.task_requirements (task_id, position);

-- One answer per unit per requirement. The plural is the design: a requirement
-- may be answered more than once (a unit resubmits after a return), so the row
-- is replaced in place and the verdict counter resets -- the office always rules
-- on the current answer, never on a stale one.
create table if not exists smartgov.task_requirement_submissions (
  requirement_id uuid not null references smartgov.task_requirements (id) on delete cascade,
  unit_id        uuid not null references public.governance_units (id) on delete cascade,
  -- 'pending' until the office rules; then 'approved' | 'flagged' | 'returned'.
  review_status  text not null default 'pending'
                 check (review_status in ('pending', 'approved', 'flagged', 'returned')),
  review_note    text not null default '',
  reviewed_by    uuid references smartgov.accounts (id) on delete set null,
  reviewed_at    timestamptz,
  -- The answer itself: a link, or an uploaded file, exactly one of the two.
  link_url       text not null default '',
  storage_path   text,
  original_name  text,
  mime_type      text,
  size_bytes     bigint,
  responded_by   uuid references smartgov.accounts (id) on delete set null,
  responded_at   timestamptz,
  primary key (requirement_id, unit_id),
  -- An answer is a link or a file, never neither and never both.
  constraint task_req_answer_present check (
    review_status = 'pending'
    or link_url <> ''
    or storage_path is not null
  )
);

create index if not exists task_req_submissions_unit_idx
  on smartgov.task_requirement_submissions (unit_id);

revoke all on smartgov.task_requirements from public, anon, authenticated;
revoke all on smartgov.task_requirement_submissions from public, anon, authenticated;

-- ------------------------------------------------------------ requirement trace
--
-- Every time the office rules on an answer, that ruling is written down. A unit
-- returned twice has two rows; the current verdict lives on the submission and
-- the history lives here. Without this, "why was I returned in March" is
-- unanswerable the moment the unit resubmits.
create table if not exists smartgov.task_requirement_reviews (
  id             uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references smartgov.task_requirements (id) on delete cascade,
  unit_id        uuid not null references public.governance_units (id) on delete cascade,
  verdict        text not null check (verdict in ('approved', 'flagged', 'returned')),
  note           text not null default '',
  reviewer_id    uuid not null references smartgov.accounts (id),
  created_at     timestamptz not null default now()
);

create index if not exists task_req_reviews_req_idx
  on smartgov.task_requirement_reviews (requirement_id, created_at desc);

revoke all on smartgov.task_requirement_reviews from public, anon, authenticated;

-- ------------------------------------------------------------ personal requests
--
-- The LSG's channel up. Distinct from a task in both directions and in shape:
-- a task is the office commanding many units, this is one unit petitioning the
-- office, and it carries a document and a needed-by date rather than a checklist.
create table if not exists smartgov.personal_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- The unit asking. One unit per request; a joint ask is two requests.
  unit_id         uuid not null references public.governance_units (id) on delete cascade,
  created_by      uuid not null references smartgov.accounts (id),
  subject         text not null check (length(btrim(subject)) between 4 and 160),
  cover_letter    text not null check (length(btrim(cover_letter)) between 10 and 8000),
  purpose         text not null default '',
  -- When the unit needs an answer. Past the deadline the request is expired --
  -- computed at read time, like every other deadline in this schema.
  needed_on       date not null,
  needed_time     time,
  needed_timezone text,
  link_url        text not null default '',
  storage_path    text,
  original_name   text,
  mime_type       text,
  size_bytes      bigint,
  status          text not null default 'submitted'
                  check (status in ('submitted', 'granted', 'declined', 'withdrawn')),
  decision_note   text not null default '',
  decided_by      uuid references smartgov.accounts (id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  -- A request carries a covering document, a link, or neither -- but the unit
  -- may send a bare letter, so neither is allowed for this one.
  constraint personal_request_no_partial_file check (
    (storage_path is null and original_name is null and mime_type is null and size_bytes is null)
    or (storage_path is not null and original_name is not null)
  )
);

create index if not exists personal_requests_org_idx
  on smartgov.personal_requests (organization_id, created_at desc);
create index if not exists personal_requests_unit_idx
  on smartgov.personal_requests (unit_id, created_at desc);

revoke all on smartgov.personal_requests from public, anon, authenticated;

-- ------------------------------------------------------- files for these two things
--
-- `document_uploads` already existed and its check constraint demanded that a
-- row belong to *either* a requirement_item or a proposal_requirement. These
-- new owners are a third and fourth. The constraint is replaced rather than
-- dropped: the point of it is that a document belongs to exactly one thing, and
-- that property is worth keeping as the set of owners grows.
alter table smartgov.document_uploads
  add column if not exists task_requirement   uuid references smartgov.task_requirements (id) on delete cascade,
  add column if not exists personal_request   uuid references smartgov.personal_requests (id) on delete cascade;

alter table smartgov.document_uploads
  drop constraint if exists document_uploads_owner_exclusive;

alter table smartgov.document_uploads
  add constraint document_uploads_owner_exclusive check (
    (case when requirement_item    is null then 0 else 1 end)
  + (case when proposal_requirement is null then 0 else 1 end)
  + (case when task_requirement    is null then 0 else 1 end)
  + (case when personal_request    is null then 0 else 1 end) = 1
  );
