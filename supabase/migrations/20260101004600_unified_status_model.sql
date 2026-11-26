-- 04600 -- Unified structure status model.
--
-- Every status-bearing table now speaks one vocabulary:
//
//   pending, draft, under_review, approved, rejected, overdue
//
// "overdue" is never written directly: effectiveStatus derives it from the due
// date on read, and a late submission is a separate flag
// (isLateSubmission), not a status of its own.
//
// Legacy values are remapped below so nothing written before this change is
// unreadable, and everything written after it uses the unified vocabulary.
//
// Every table here keeps RLS and its existing grants; only the check constraint
-- on `status` changes, plus a backfill of legacy values.

-- ------------------------------------------------------------------ task assignments
alter table smartgov.task_assignments
  drop constraint if exists task_assignments_status_check;

update smartgov.task_assignments
   set status = 'draft'
 where status = 'assigned';
update smartgov.task_assignments
   set status = 'under_review'
 where status = 'in_progress';
update smartgov.task_assignments
   set status = 'pending'
 where status = 'submitted';
update smartgov.task_assignments
   set status = 'approved'
 where status = 'done';

alter table smartgov.task_assignments
  add constraint task_assignments_status_check
  check (status in ('pending','draft','under_review','approved','rejected','overdue'));

-- ------------------------------------------------------------------ budget requests
alter table smartgov.budget_requests
  drop constraint if exists budget_requests_status_check;

update smartgov.budget_requests
   set status = 'pending'
 where status = 'submitted';
update smartgov.budget_requests
   set status = 'rejected'
 where status = 'returned';

alter table smartgov.budget_requests
  add constraint budget_requests_status_check
  check (status in ('pending','draft','under_review','approved','rejected','overdue'));

-- ------------------------------------------------------------------ resolutions
alter table smartgov.resolutions
  drop constraint if exists resolutions_status_check;

update smartgov.resolutions
   set status = 'pending'
 where status = 'submitted';
update smartgov.resolutions
   set status = 'rejected'
 where status = 'returned';
update smartgov.resolutions
   set status = 'approved'
 where status = 'published';

alter table smartgov.resolutions
  add constraint resolutions_status_check
  check (status in ('pending','draft','under_review','approved','rejected','overdue'));

-- ------------------------------------------------------------------ government structures
alter table smartgov.gov_structures
  drop constraint if exists gov_structures_status_check;

update smartgov.gov_structures
   set status = 'pending'
 where status = 'submitted';
update smartgov.gov_structures
   set status = 'rejected'
 where status in ('returned','superseded');

alter table smartgov.gov_structures
  add constraint gov_structures_status_check
  check (status in ('pending','draft','under_review','approved','rejected','overdue'));

-- ------------------------------------------------------------------ proposals
alter table smartgov.proposals
  drop constraint if exists proposals_status_check;

update smartgov.proposals
   set status = 'pending'
 where status = 'submitted';
update smartgov.proposals
   set status = 'rejected'
 where status = 'returned';
update smartgov.proposals
   set status = 'approved'
 where status = 'published';

alter table smartgov.proposals
  add constraint proposals_status_check
  check (status in ('pending','draft','under_review','approved','rejected','overdue'));

-- ------------------------------------------------------------------ personal requests
alter table smartgov.personal_requests
  drop constraint if exists personal_requests_status_check;

update smartgov.personal_requests
   set status = 'pending'
 where status = 'submitted';
update smartgov.personal_requests
   set status = 'approved'
 where status = 'granted';
update smartgov.personal_requests
   set status = 'rejected'
 where status in ('declined','withdrawn','expired');
update smartgov.personal_requests
   set status = 'under_review'
 where status in ('needs_revision','submission_required');

alter table smartgov.personal_requests
  add constraint personal_requests_status_check
  check (status in ('pending','draft','under_review','approved','rejected','overdue'));

-- ------------------------------------------------------------------ events
alter table smartgov.events
  drop constraint if exists events_status_check;

update smartgov.events
   set status = 'pending'
 where status = 'upcoming';
update smartgov.events
   set status = 'under_review'
 where status = 'claimed';
update smartgov.events
   set status = 'approved'
 where status = 'honored';

alter table smartgov.events
  add constraint events_status_check
  check (status in ('pending','draft','under_review','approved','rejected','overdue'));

-- ------------------------------------------------------------------ document catalog
alter table smartgov.document_catalog
  drop constraint if exists document_catalog_approval_status_check;

update smartgov.document_catalog
   set approval_status = 'pending'
 where approval_status = 'submitted';

alter table smartgov.document_catalog
  add constraint document_catalog_approval_status_check
  check (approval_status in ('pending','draft','under_review','approved','rejected','overdue'));

-- ------------------------------------------------------------------ feedback forms
alter table smartgov.feedback_forms
  drop constraint if exists feedback_forms_status_check;

update smartgov.feedback_forms
   set status = 'pending'
 where status = 'open';
update smartgov.feedback_forms
   set status = 'rejected'
 where status = 'closed';

alter table smartgov.feedback_forms
  add constraint feedback_forms_status_check
  check (status in ('pending','draft','under_review','approved','rejected','overdue'));

-- ------------------------------------------------------------------ feedback entries
alter table smartgov.feedback_entries
  drop constraint if exists feedback_entries_status_check;

update smartgov.feedback_entries
   set status = 'pending'
 where status = 'new';
update smartgov.feedback_entries
   set status = 'approved'
 where status = 'acknowledged';

alter table smartgov.feedback_entries
  add constraint feedback_entries_status_check
  check (status in ('pending','draft','under_review','approved','rejected','overdue'));

-- ------------------------------------------------------------------ accomplishment reports
alter table smartgov.accomplishment_reports
  drop constraint if exists accomplishment_reports_status_check;

update smartgov.accomplishment_reports
   set status = 'pending'
 where status = 'submitted';
update smartgov.accomplishment_reports
   set status = 'approved'
 where status = 'acknowledged';
update smartgov.accomplishment_reports
   set status = 'rejected'
 where status = 'returned';

alter table smartgov.accomplishment_reports
  add constraint accomplishment_reports_status_check
  check (status in ('pending','draft','under_review','approved','rejected','overdue'));

-- ------------------------------------------------------------------ task requirement submissions
alter table smartgov.task_requirement_submissions
  drop constraint if exists task_requirement_submissions_review_status_check;

update smartgov.task_requirement_submissions
   set review_status = 'rejected'
 where status = 'flagged';
update smartgov.task_requirement_submissions
   set review_status = 'rejected'
 where status = 'returned';

alter table smartgov.task_requirement_submissions
  add constraint task_requirement_submissions_review_status_check
  check (review_status in ('pending','draft','under_review','approved','rejected','overdue'));
