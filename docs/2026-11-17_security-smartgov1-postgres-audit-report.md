# SmartGov1 Postgres schema and security audit

> Audit date: 2026-11-17
> Auditor: AI
> Scope: `smartgov1` repository and its locally configured Postgres/Supabase database
> Authorization basis: requester-directed audit of the local repository and configured database
> Report type: white-box schema, ACL, RPC security, and dead-code audit
> Data handling: no secret values, passwords, tokens, or full connection URLs are reproduced

## Executive summary

A read-only catalog and source audit was performed against the database configured in `.env.local`, plus Next.js routes and Supabase migrations in the repository. The live database reported Postgres 17.6, SSL enabled, database `postgres`, and user `postgres`. The audit covered 54 tables, 532 columns, 258 constraints, 125 indexes, 74 enum values, 5 triggers, 369 functions, 929 function ACL rows, 464 table ACL rows, and 167 public wrapper functions.

Three high-severity issues were confirmed:

1. `public.list_requirement_answer_versions` is a `SECURITY DEFINER` RPC executable by `PUBLIC`, `anon`, and `authenticated`, but it ignores its session-token argument. A read-only live call as `anon` with `invalid-token` returned `ok: true`. The target table currently has 0 rows, so no current data exposure was observed, but the authorization bypass is confirmed.
2. Survey OTP creation and verification accept a caller-supplied SHA-256 hash and, for creation, a caller-supplied TTL through `anon`-executable `SECURITY DEFINER` wrappers. This allows a direct RPC caller to choose the code hash and then verify against it, bypassing the email-possession assumption. No state-changing proof was executed.
3. `smartgov.get_survey` returns survey questions for `email_otp` surveys without requiring OTP verification. The client hides the form until local `otpVerified` is true, but the API exposes questions directly. The current database has 0 `email_otp` surveys, so impact is conditional on future configuration.

Additional confirmed issues include 46 `PUBLIC`-executable `SECURITY DEFINER` wrappers, 9 definer functions without an explicit `search_path`, 26 RLS-enabled tables with 0 policies, 8 heuristic missing-FK candidates, 5 status columns without table-level CHECK constraints, 70 foreign keys without a leading index, and 56 orphan-prone foreign keys. Dead-code conclusions remain conditional because `track_functions` is `none` and no function usage statistics exist.

No DML or DDL was executed. The only role-sensitive live check used `BEGIN`, `SET LOCAL ROLE anon`, one `SELECT`, and `ROLLBACK`.

## Scope and method

| Item | Detail |
| --- | --- |
| Repository | `C:\Users\Julius M. Matro\Desktop\smartgov1` |
| Database | Configured through `.env.local`; URL redacted |
| Live DB identity | database `postgres`, user `postgres`, Postgres 17.6, SSL on |
| psql client | `C:\Program Files\PostgreSQL\18\bin\psql.exe` |
| Runner | Temporary PowerShell helper that reads `DATABASE_URL`, appends `sslmode=require` when absent, and invokes psql with `ON_ERROR_STOP=1` |
| Test type | Catalog queries, source review, and one read-only anon-role RPC call |
| Schemas reviewed | `smartgov`, `public`, plus inventory of non-system schemas |
| Change policy | Read-only; no INSERT, UPDATE, DELETE, DDL, or privilege changes |
| HTTP testing | Not performed |
| Secret handling | Connection string and credentials were not printed |

The catalog scripts are reproduced verbatim in Appendix A. Two initial catalog queries failed and were corrected: `02_funcs_rls.sql` used PG17-invalid `last_user_scan`/`last_user_write` columns, and `03_analysis.sql` used an invalid `has_function_privilege(p.oid,'PUBLIC','EXECUTE')` call. Corrected versions appear in `04_fix.sql`.

## Findings summary

| ID | Finding | Severity | Status | Current exposure |
| --- | --- | --- | --- | --- |
| F-01 | Session token ignored by requirement answer version RPC | High | Confirmed by source, catalog, and live anon call | No rows in target table |
| F-02 | Survey OTP hash and TTL are caller-controlled | High | Confirmed by source and catalog; no state-changing proof | No OTP rows; no `email_otp` surveys |
| F-03 | `email_otp` question access is client-side only | High | Confirmed by source and catalog | No `email_otp` surveys |
| F-04 | Broad `PUBLIC` execute surface on definer wrappers | Medium | Confirmed by catalog | Present |
| F-05 | Definer functions without explicit `search_path` | Medium | Confirmed by catalog | Present; no unqualified-object exploit shown |
| F-06 | RLS enabled on 26 tables with 0 policies | Low | Confirmed by catalog | No direct anon/auth table grants |
| F-07 | Data-integrity gaps and unindexed FKs | Low | Pending validation | Heuristic catalog findings |
| F-08 | Dead-code candidates require source validation | Informational | Pending validation | No runtime usage stats |

## Findings

### F-01: Session token ignored by requirement answer version RPC

**Severity:** High
**Status:** Confirmed by source, catalog, and live read-only anon call

**Evidence block**

- **Title:** Unauthenticated access to requirement answer version metadata through token-ignoring definer RPC
- **Location:** `supabase/migrations/20260101003180_task_board_enhancements.sql:158-175`; catalog output `05_final.out`; live check `06_verify.out`
- **Time:** 2026-11-17, audit session around 17:20 +08:00
- **Preconditions:** Database is reachable and the caller can invoke the `public` RPC. No valid session token is required.
- **Step-by-step query or reproduction:**
  1. Inspect the wrapper definition using `pg_get_functiondef`.
  2. Inspect ACLs using `aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))`.
  3. Run the read-only transaction as `anon`:
     ```sql
     BEGIN;
     SET LOCAL ROLE anon;
     SELECT public.list_requirement_answer_versions(
       'invalid-token',
       '00000000-0000-0000-0000-000000000000'::uuid,
       '00000000-0000-0000-0000-000000000000'::uuid
     ) AS anon_result;
     ROLLBACK;
     ```
- **Observed result:** The wrapper is `DEFINER`, has no `search_path`, and its execute grantees are `PUBLIC,postgres,anon,authenticated,service_role`. The definition declares `p_session_token` but the body never references it. The anon-role call returned `{"ok": true, "versions": []}`. `smartgov.task_requirement_answer_versions` has 0 rows.
- **Impact:** Once answer versions exist, any caller who knows or guesses `p_requirement_id` and optional `p_unit_id` can retrieve version numbers, `linkUrl`, `storagePath`, original file name, MIME type, size, review status, review notes, and response timestamps without valid authorization. This is an object-level authorization bypass with potential exposure of storage paths.
- **Non-destructive proof:** The proof used only catalog reads and a `SELECT` inside a transaction that was rolled back. No rows were read because the table is empty.
- **Residual risk:** HTTP/PostgREST exposure was not tested. Absence of current rows limits observed disclosure but does not mitigate the authorization defect.
- **Fix or detection recommendation:** Either remove `p_session_token` from the RPC and enforce access through a trusted server-side path, or validate it with `smartgov.authenticate` plus explicit requirement/unit authorization before selecting. Revoke `PUBLIC` execute if the RPC is not intended for unrestricted database roles. Add a regression test that calls the RPC with an invalid token and expects failure.
- **Evidence attachment names:** `05_final.sql`, `06_verify.sql`, `05_final.out`, `06_verify.out`, `20260101003180_task_board_enhancements.sql`.

### F-02: Survey OTP hash and TTL are caller-controlled

**Severity:** High
**Status:** Confirmed by source and catalog; no state-changing proof executed

**Evidence block**

- **Title:** Email OTP possession check can be bypassed through direct RPC calls
- **Location:** `supabase/migrations/20260101003190_survey_branching_otp.sql:117-160`; `src/app/api/surveys/[id]/otp/verify/route.ts:8-26`; catalog output `06_verify.out`
- **Time:** 2026-11-17, audit session around 17:20 +08:00
- **Preconditions:** An attacker can call the public RPC directly and knows or guesses a survey UUID and an email address. The impact is realized when a survey uses `email_otp` access mode.
- **Step-by-step query or reproduction:**
  1. Read `smartgov.create_survey_otp` and `smartgov.verify_survey_otp` definitions from the migration.
  2. Confirm wrapper grants with the section 33 catalog query in `06_verify.sql`.
  3. Note that `create_survey_otp(p_survey_id, p_email, p_code_hash, p_ttl_minutes)` inserts the caller's hash directly and computes expiry from the caller's TTL.
  4. Note that `verify_survey_otp(p_survey_id, p_email, p_code_hash)` matches the caller's hash against the stored hash and marks the row used.
  5. The Next.js route hashes the submitted code before calling the RPC, but direct RPC callers are not required to use that route.
- **Observed result:** Both wrappers are `DEFINER`, have no `search_path`, and are executable by `PUBLIC`, `postgres`, `anon`, `authenticated`, and `service_role`. The underlying functions do not generate the code, do not bind it to a server-held secret, do not validate `access_mode = 'email_otp'`, and do not apply rate limiting. `smartgov.survey_access_otps` has 0 rows; both current surveys use `authenticated` mode and there are no `email_otp` surveys.
- **Impact:** A caller can create an OTP row with the hash of a code they choose, then verify with the same code. This defeats email possession for `email_otp` surveys. Caller-controlled TTL can also create long-lived or immediately expired rows.
- **Non-destructive proof:** Confirmation is based on DDL source and live catalog ACL metadata. Because the audit prohibited writes, no OTP row was created or verified.
- **Residual risk:** No HTTP-level proof was attempted. The current dataset contains no `email_otp` surveys and no OTP rows, so impact is conditional on future configuration.
- **Fix or detection recommendation:** Generate and store the OTP hash inside a trusted server-side flow; do not accept `p_code_hash` or `p_ttl_minutes` from untrusted callers. Validate that the survey exists and uses `email_otp`, enforce per-email and per-IP rate limits in `smartgov.rate_limits`, consume the OTP atomically, and revoke unnecessary direct RPC grants. Alert on unexpectedly long `expires_at - created_at` values.
- **Evidence attachment names:** `06_verify.sql`, `07_public_exec.sql`, `08_survey_modes.sql`, `06_verify.out`, `07_public_exec.out`, `08_survey_modes.out`, `20260101003190_survey_branching_otp.sql`, `otp/verify/route.ts`.

### F-03: Email OTP question access is client-side only

**Severity:** High
**Status:** Confirmed by source and catalog

**Evidence block**

- **Title:** `email_otp` surveys expose questions through the survey read API without OTP verification
- **Location:** `supabase/migrations/20260101003190_survey_branching_otp.sql:182-248`; `src/app/api/surveys/[id]/route.ts:28-46`; `src/app/survey/[id]/page.tsx:53-76,201`
- **Time:** 2026-11-17, audit session around 17:20 +08:00
- **Preconditions:** A published survey uses `access_mode = 'email_otp'`.
- **Step-by-step query or reproduction:**
  1. Inspect `smartgov.get_survey`; its `email_otp` branch is a no-op with a comment stating OTP is verified separately.
  2. Observe that the function returns all survey questions at lines 231-247.
  3. Inspect `GET /api/surveys/[id]`; it calls `get_survey` and returns `res.questions`.
  4. Inspect the client page; it only hides the form when `survey.accessMode === "email_otp" && !otpVerified`.
  5. Call the GET API directly without performing OTP verification.
- **Observed result:** `smartgov.get_survey` has no server-side OTP check for `email_otp`. The public wrapper is executable by `anon` and `authenticated`. The current database has 2 surveys, both `authenticated`, so no live `email_otp` disclosure was observed.
- **Impact:** Any caller who knows a survey UUID can retrieve its questions before email verification. OTP gating is advisory in the browser and is not an access-control boundary.
- **Non-destructive proof:** Confirmation is based on migration and route source plus catalog metadata. No live HTTP request against an `email_otp` survey was possible because none exists.
- **Residual risk:** Answers, response submission, and result access were not fully exercised. The finding applies to question confidentiality only.
- **Fix or detection recommendation:** Enforce OTP state server-side before returning questions. Add an `otpVerified` server-issued artifact or move question retrieval behind a verified-OTP API. Treat the client flag as presentation state only.
- **Evidence attachment names:** `20260101003190_survey_branching_otp.sql`, `src/app/api/surveys/[id]/route.ts`, `src/app/survey/[id]/page.tsx`, `05_final.out`, `08_survey_modes.out`.

### F-04: Broad PUBLIC execute surface on definer wrappers

**Severity:** Medium
**Status:** Confirmed by catalog

**Evidence block**

- **Title:** 46 `PUBLIC`-executable `SECURITY DEFINER` functions in `public`
- **Location:** `05_final.out` section 28; `07_public_exec.out`
- **Time:** 2026-11-17, audit session around 17:20 +08:00
- **Preconditions:** A database role exists that can connect and invoke `public` functions.
- **Step-by-step query or reproduction:** Run section 35 from `07_public_exec.sql`, joining `pg_proc`, `pg_namespace`, and `aclexplode` to select `prosecdef` functions with a `PUBLIC EXECUTE` ACL entry.
- **Observed result:** 46 functions are both `SECURITY DEFINER` and `PUBLIC`-executable. Examples include `login_account`, `delete_session`, `accept_invite`, `create_owner_account`, `create_survey_otp`, `verify_survey_otp`, `add_survey_question`, `update_survey_question`, `submit_requirement_answer`, `review_requirement_answer`, and `list_requirement_answer_versions`. In total, 167 public wrappers were found: 166 definer and 1 invoker.
- **Impact:** `PUBLIC` execute is broader than `anon`/`authenticated` and grants any database role the ability to enter privileged wrapper code. The actual risk depends on each function's internal authorization; F-01 and F-02 demonstrate that at least some wrappers do not enforce it correctly.
- **Non-destructive proof:** Catalog-only query; no function was invoked except the read-only call in F-01.
- **Residual risk:** Most wrappers pass a session token to `smartgov.*` functions that may validate it. This audit did not individually test all 46 functions.
- **Fix or detection recommendation:** Revoke `PUBLIC EXECUTE` from wrappers that do not require it, grant only `anon`/`authenticated` where PostgREST access is needed, and generate a periodic catalog diff for new definer functions with `PUBLIC EXECUTE`.
- **Evidence attachment names:** `05_final.sql`, `07_public_exec.sql`, `05_final.out`, `07_public_exec.out`.

### F-05: Definer functions without explicit search_path

**Severity:** Medium
**Status:** Confirmed by catalog; no unqualified-object exploit demonstrated

**Evidence block**

- **Title:** 9 `SECURITY DEFINER` functions have no `search_path` setting
- **Location:** `05_final.out` section 29
- **Time:** 2026-11-17, audit session around 17:20 +08:00
- **Preconditions:** A definer function with unqualified object references would be exposed to caller-controlled `search_path` resolution.
- **Step-by-step query or reproduction:** Run section 29 from `05_final.sql` and filter `pg_proc` for `prosecdef = true` and `proconfig IS NULL`.
- **Observed result:** The nine functions are `add_survey_question`, `create_survey_otp`, `decide_task_extension`, `get_task_requirement_file`, `list_requirement_answer_versions`, `list_task_extensions`, `request_task_extension`, `update_survey_question`, and `verify_survey_otp`.
- **Impact:** Missing `search_path` is a definer-function hardening gap. No unqualified table/function reference was shown in the reviewed bodies, so a practical search-path hijack was not confirmed.
- **Non-destructive proof:** Catalog-only query and source inspection; no exploit was executed.
- **Residual risk:** Future edits could introduce unqualified references. The issue is also linked to the high-severity wrappers in F-01 and F-02.
- **Fix or detection recommendation:** Add `SET search_path = public, extensions, smartgov, pg_temp` to all nine definer functions, matching the pattern used by the remaining wrappers. Add a migration guard that fails when a definer function has no `proconfig`.
- **Evidence attachment names:** `05_final.sql`, `05_final.out`, `20260101003180_task_board_enhancements.sql`, `20260101003190_survey_branching_otp.sql`.

### F-06: RLS enabled on 26 tables with 0 policies

**Severity:** Low
**Status:** Confirmed by catalog

**Evidence block**

- **Title:** RLS is enabled without policies on 26 tables
- **Location:** `02_funcs_rls.out` sections 10-12; `03_analysis.out` section 19
- **Time:** 2026-11-17, audit session around 17:20 +08:00
- **Preconditions:** RLS is meaningful only for roles subject to it and with direct table privileges.
- **Step-by-step query or reproduction:** Compare `pg_class.relrowsecurity` with the presence of rows in `pg_policy`, then inspect exploded table ACLs.
- **Observed result:** 26 tables have RLS enabled and no policies. Total policy count is 0. Table ACL grantees are only `postgres` and `service_role`; no `anon`, `authenticated`, or `PUBLIC` direct table grants were found.
- **Impact:** With zero policies and no direct untrusted table grants, direct table access is fail-closed for ordinary roles. The main risk is architectural: access control depends entirely on wrapper functions, so a wrapper authorization mistake becomes the only boundary.
- **Non-destructive proof:** Catalog-only reads. No table data was read through direct table access.
- **Residual risk:** `service_role` bypasses RLS by design. Direct grants added in the future would produce deny-by-default behavior unless policies are also added.
- **Fix or detection recommendation:** Document that the database uses wrapper-only access. Add a check that alerts if direct table grants appear on RLS tables with no policies. If direct client table access is ever required, define explicit restrictive policies.
- **Evidence attachment names:** `02_funcs_rls.sql`, `03_analysis.sql`, `02_funcs_rls.out`, `03_analysis.out`.

### F-07: Data-integrity gaps and unindexed foreign keys

**Severity:** Low
**Status:** Pending validation

**Evidence block**

- **Title:** Heuristic integrity gaps: 8 missing FKs, 5 status columns without CHECK, 70 unindexed FKs, 56 orphan-prone FKs
- **Location:** `03_analysis.out` sections 15, 17, 18, and 20
- **Time:** 2026-11-17, audit session around 17:20 +08:00
- **Preconditions:** Heuristic results require manual review because polymorphic IDs and enum types can be valid without FK or CHECK constraints.
- **Step-by-step query or reproduction:** Run sections 15, 17, 18, and 20 from `03_analysis.sql`.
- **Observed result:** Missing-FK candidates are `smartgov.accounts.deactivation_scheduled_by`, `smartgov.audit_log.organization_id`, `smartgov.audit_log.target_id`, `smartgov.conversations.organization_id`, `smartgov.events.organization_id`, `smartgov.events.unit_id`, `smartgov.notifications.organization_id`, and `smartgov.surveys.organization_id`. Status columns without CHECK are `public.organizations.status` (`org_status`), `public.submissions.status` (`text`), `smartgov.accounts.status` (`smartgov.account_status`), `smartgov.invites.status` (`smartgov.invite_status`), and `smartgov.task_requirement_answer_versions.review_status` (`text`). The three enum-typed columns are already constrained by their types.
- **Impact:** Missing FKs can permit orphan identifiers. Unindexed FKs can slow joins and cascades. Orphan-prone definitions combine nullable columns or `NO ACTION`/`RESTRICT` and may leave dangling or blocking references depending on application behavior.
- **Non-destructive proof:** Catalog-only heuristics; no data mutation and no referential-integrity scan was performed.
- **Residual risk:** Some `*_id` columns may intentionally reference polymorphic or external objects. No live data set currently exposes most relationships because many tables have 0 rows.
- **Fix or detection recommendation:** Validate each candidate against the data model, add FKs where relationships are strict, add leading indexes for join/cascade columns, and add CHECK constraints or enum types for text status columns.
- **Evidence attachment names:** `03_analysis.sql`, `03_analysis.out`, `01_core.sql`, `01_core.out`.

### F-08: Dead-code candidates require source validation

**Severity:** Informational
**Status:** Pending validation

**Evidence block**

- **Title:** 36 smartgov functions have no public wrapper; 5 have no catalog-visible wrapper or function reference
- **Location:** `03_analysis.out` section 21; `05_final.out` sections 30 and 31; `01_core.out` section 6
- **Time:** 2026-11-17, audit session around 17:20 +08:00
- **Preconditions:** Runtime usage cannot be confirmed because `track_functions = none` and `pg_stat_user_functions` has 0 rows.
- **Step-by-step query or reproduction:** Run sections 21, 22, and 30 from the catalog scripts, then correlate candidates with trigger definitions from section 6 of `01_core.sql`.
- **Observed result:** Section 30 lists `bind_document_to_proposal`, `refresh_invite_status`, `release_document_object`, `roster_photo_purge`, and `snapshot_requirement_answer`. Four of these are trigger functions and are therefore not dead: `bind_document_to_proposal`, `release_document_object`, `roster_photo_purge`, and `snapshot_requirement_answer`. `refresh_invite_status` has no caller found in repository source and remains the only plausible dead function. Section 22's four results were false positives caused by regex matches against enum/table names, including `resolve_account` and `list_requirement_answer_versions`.
- **Impact:** Dead functions increase review and attack surface. The heuristic alone is insufficient to justify deletion.
- **Non-destructive proof:** Catalog and source-reference review only; no function state was changed.
- **Residual risk:** Dynamic SQL or external schedulers may call a function that static catalog queries do not see.
- **Fix or detection recommendation:** Confirm `refresh_invite_status` has no external caller, then remove it or publish it deliberately. Do not remove the four trigger functions. Enable `track_functions = all` temporarily in a non-production window if runtime validation is required.
- **Evidence attachment names:** `03_analysis.sql`, `05_final.sql`, `01_core.sql`, `03_analysis.out`, `05_final.out`, `01_core.out`.

## Attack path

```mermaid
flowchart LR
    A[Anonymous database or RPC caller] --> B[public.list_requirement_answer_versions]
    B --> C[No p_session_token validation]
    C --> D[SECURITY DEFINER read of smartgov.task_requirement_answer_versions]
    D --> E[Version metadata and storage paths]

    A --> F[public.create_survey_otp]
    F --> G[Attacker-chosen code_hash and TTL]
    G --> H[public.verify_survey_otp]
    H --> I[Client otpVerified state]

    A --> J[GET /api/surveys/[id]]
    J --> K[smartgov.get_survey email_otp branch is a no-op]
    K --> L[Questions returned before OTP verification]
```

## Remediation priorities

| Priority | Action | Related findings |
| --- | --- | --- |
| P0 | Add real authorization to `list_requirement_answer_versions` and invalidate tokens that fail authentication. | F-01 |
| P0 | Move OTP generation and TTL control server-side; remove caller-supplied hash acceptance. | F-02 |
| P0 | Enforce OTP verification server-side before returning `email_otp` questions. | F-03 |
| P1 | Revoke unnecessary `PUBLIC EXECUTE` and apply explicit `search_path` to all definer wrappers. | F-04, F-05 |
| P1 | Add regression tests that call sensitive RPCs as `anon` with invalid inputs. | F-01, F-02, F-03, F-04 |
| P2 | Review FK, CHECK, and index candidates; document wrapper-only RLS architecture. | F-06, F-07 |
| P2 | Validate and remove only genuinely unused functions after external-caller review. | F-08 |

## Environment facts

| Metric | Value |
| --- | --- |
| Tables | 54 |
| Columns | 532 |
| Constraints | 258 |
| Indexes | 125 |
| Enum values | 74 |
| Triggers | 5 |
| Views | 0 |
| Materialized views | 0 |
| Functions | 369 |
| Function ACL rows | 929 |
| Table ACL rows | 464 |
| RLS policies | 0 |
| Public wrappers | 167 |
| Definer wrappers | 166 |
| Invoker wrappers | 1 |
| Definer functions without `search_path` | 9 |
| Functions without PUBLIC execute | 312 |
| Functions without same-name public wrapper | 36 |

Exact row counts were obtained for all 54 tables. Tables with current data include `smartgov.accounts` (14), `sessions` (14), `notifications` (33), `rate_limits` (32), `roster` (13), `invites` (13), `task_assignments` (15), `org_positions` (6), `governance_units` (6), `events` (2), `surveys` (2), `survey_responses` (2), `proposals` (2), `proposal_versions` (2), `personal_requests` (2), `conversations` (1), `conversation_participants` (3), `dashboard_layouts` (1), `budget_requests` (1), and `messages` (2). Security-sensitive tables currently empty include `survey_access_otps`, `task_requirement_answer_versions`, `task_requirement_submissions`, `task_requirement_reviews`, `task_extensions`, `document_uploads`, `password_resets`, `reviews`, and `submission_verifications`.

## Appendix A: exact catalog SQL queries used

### 00_probe.sql

```sql
\echo '=== CONNECTION PROBE ==='
SELECT current_database() AS db, current_user AS usr, current_setting('server_version') AS pg_version, current_setting('ssl') AS ssl_on;
\echo '=== NON-SYSTEM SCHEMAS ==='
SELECT n.nspname AS schema_name, pg_get_userbyid(n.nspowner) AS owner,
       obj_description(n.oid, 'pg_namespace') AS description
FROM pg_namespace n
WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
ORDER BY n.nspname;
```

### 01_core.sql

```sql
\echo '=== 01 TABLES + ROW ESTIMATES (smartgov, public) ==='
SELECT c.relkind, n.nspname AS schema_name, c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       GREATEST(c.reltuples,0)::bigint AS reltuples_est,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
       obj_description(c.oid,'pg_class') AS description
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('smartgov','public') AND c.relkind IN ('r','p','f','m')
ORDER BY n.nspname, c.relname;

\echo '=== 02 COLUMNS (smartgov, public) ==='
SELECT table_schema, table_name, ordinal_position, column_name,
       data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale,
       is_nullable, column_default, is_identity, identity_generation, collation_name
FROM information_schema.columns
WHERE table_schema IN ('smartgov','public')
ORDER BY table_schema, table_name, ordinal_position;

\echo '=== 03 CONSTRAINTS (PK/FK/UNIQUE/CHECK/EXCLUDE) ==='
SELECT n.nspname AS schema_name, cl.relname AS table_name, con.conname AS constraint_name,
       CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'f' THEN 'FOREIGN KEY' WHEN 'u' THEN 'UNIQUE' WHEN 'c' THEN 'CHECK' WHEN 'x' THEN 'EXCLUDE' ELSE con.contype::text END AS constraint_type,
       pg_get_constraintdef(con.oid) AS definition,
       con.condeferrable, con.condeferred,
       CASE WHEN con.contype='f' THEN (SELECT n2.nspname||'.'||c2.relname FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid=c2.relnamespace WHERE c2.oid=con.confrelid) END AS referenced_table,
       CASE WHEN con.contype='f' THEN (SELECT string_agg(a.attname,', ' ORDER BY u.ord) FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum,ord) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=u.attnum) END AS fk_columns,
       CASE WHEN con.contype='f' THEN (SELECT string_agg(a.attname,', ' ORDER BY u.ord) FROM unnest(con.confkey) WITH ORDINALITY AS u(attnum,ord) JOIN pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=u.attnum) END AS referenced_columns,
       CASE WHEN con.contype='f' THEN con.confdeltype END AS on_delete_code,
       CASE WHEN con.contype='f' THEN con.confupdtype END AS on_update_code
FROM pg_constraint con
JOIN pg_class cl ON cl.oid=con.conrelid
JOIN pg_namespace n ON n.oid=cl.relnamespace
WHERE n.nspname IN ('smartgov','public') AND con.contype IN ('p','f','u','c','x')
ORDER BY n.nspname, cl.relname, con.contype, con.conname;

\echo '=== 04 INDEXES ==='
SELECT n.nspname AS schema_name, c.relname AS table_name, i.relname AS index_name,
       pg_get_indexdef(i.oid) AS indexdef,
       ix.indisunique, ix.indisprimary, ix.indisvalid, ix.indisready, ix.indisexclusion
FROM pg_index ix
JOIN pg_class i ON i.oid=ix.indexrelid
JOIN pg_class c ON c.oid=ix.indrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('smartgov','public')
ORDER BY n.nspname, c.relname, i.relname;

\echo '=== 05 ENUM TYPES AND VALUES (all non-system schemas) ==='
SELECT n.nspname AS schema_name, t.typname AS enum_name, e.enumlabel AS enum_value, e.enumsortorder
FROM pg_type t
JOIN pg_enum e ON e.enumtypid=t.oid
JOIN pg_namespace n ON n.oid=t.typnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
  AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
ORDER BY n.nspname, t.typname, e.enumsortorder;

\echo '=== 06 TRIGGERS ==='
SELECT n.nspname AS schema_name, cl.relname AS table_name, tg.tgname AS trigger_name,
       CASE WHEN tg.tgenabled='O' THEN 'ENABLED' WHEN tg.tgenabled='D' THEN 'DISABLED' WHEN tg.tgenabled='R' THEN 'REPLICA' WHEN tg.tgenabled='A' THEN 'ALWAYS' ELSE tg.tgenabled::text END AS status,
       pn.nspname AS function_schema, p.proname AS function_name,
       pg_get_triggerdef(tg.oid) AS definition
FROM pg_trigger tg
JOIN pg_class cl ON cl.oid=tg.tgrelid
JOIN pg_namespace n ON n.oid=cl.relnamespace
LEFT JOIN pg_proc p ON p.oid=tg.tgfoid
LEFT JOIN pg_namespace pn ON pn.oid=p.pronamespace
WHERE n.nspname IN ('smartgov','public') AND NOT tg.tgisinternal
ORDER BY n.nspname, cl.relname, tg.tgname;

\echo '=== 07 VIEWS ==='
SELECT table_schema, table_name, check_option, is_updatable, is_insertable_into, view_definition
FROM information_schema.views
WHERE table_schema IN ('smartgov','public')
ORDER BY table_schema, table_name;

\echo '=== 07b MATERIALIZED VIEWS ==='
SELECT n.nspname AS schema_name, m.matviewname, m.ispopulated, m.definition
FROM pg_matviews m JOIN pg_namespace n ON n.nspname=m.schemaname
WHERE n.nspname IN ('smartgov','public')
ORDER BY 1,2;
```

### 02_funcs_rls.sql

```sql
\echo '=== 08 FUNCTIONS METADATA (smartgov + public) ==='
SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS returns,
       p.prosecdef AS security_definer,
       array_to_string(p.proconfig, ', ') AS config,
       pg_get_userbyid(p.proowner) AS owner,
       l.lanname, p.provolatile, p.proparallel, p.proisstrict,
       obj_description(p.oid,'pg_proc') AS description
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname IN ('smartgov','public')
ORDER BY n.nspname, p.proname, arguments;

\echo '=== 09 FUNCTION ACLs (exploded) ==='
SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.proacl IS NULL AS acl_is_null_default,
       pg_get_userbyid(a.grantee) AS grantee, a.privilege_type, a.is_grantable
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
WHERE n.nspname IN ('smartgov','public')
ORDER BY n.nspname, p.proname, arguments, grantee, a.privilege_type;

\echo '=== 10 RLS STATUS (tables) ==='
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('smartgov','public') AND c.relkind IN ('r','p','f','m')
ORDER BY n.nspname, c.relname;

\echo '=== 11 RLS POLICIES ==='
SELECT n.nspname AS schema_name, c.relname AS table_name, pol.polname AS policy_name,
       pol.polpermissive AS permissive,
       (SELECT string_agg(pg_get_userbyid(r), ', ' ORDER BY r) FROM unnest(pol.polroles) r) AS roles,
       CASE pol.polcmd WHEN 'a' THEN 'ALL' WHEN 'r' THEN 'SELECT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN 'i' THEN 'INSERT' ELSE pol.polcmd::text END AS cmd,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expr
FROM pg_policy pol
JOIN pg_class c ON c.oid=pol.polrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('smartgov','public')
ORDER BY n.nspname, c.relname, pol.polname;

\echo '=== 12 TABLE ACLs (exploded) ==='
SELECT n.nspname AS schema_name, c.relname AS table_name,
       pg_get_userbyid(a.grantee) AS grantee, a.privilege_type, a.is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
WHERE n.nspname IN ('smartgov','public') AND c.relkind IN ('r','p')
ORDER BY n.nspname, c.relname, grantee, a.privilege_type;

\echo '=== 13 TABLE USAGE STATS ==='
SELECT n.nspname AS schema_name, s.relname AS table_name,
       s.seq_scan, s.idx_scan, s.n_tup_ins, s.n_tup_upd, s.n_tup_del,
       s.last_user_scan, s.last_user_write
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid=s.relid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('smartgov','public')
ORDER BY n.nspname, s.relname;

\echo '=== 13b FUNCTION STATS SETTING ==='
SELECT current_setting('track_functions') AS track_functions;
```

### 03_analysis.sql

```sql
\echo '=== 14 FUNCTION INVENTORY (compact) ==='
SELECT n.nspname AS sch, p.proname AS fn,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS returns,
       CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS sec,
       COALESCE(array_to_string(p.proconfig,'; '),'(none)') AS config,
       (SELECT string_agg(DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type, ',' ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type)
        FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a) AS acl,
       COALESCE((SELECT string_agg(DISTINCT m[1], ',' ORDER BY m[1]) FROM regexp_matches(pg_get_functiondef(p.oid), 'smartgov\.([a-zA-Z_][a-zA-Z0-9_]*)','g') m),'') AS smartgov_refs
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('smartgov','public')
ORDER BY n.nspname, p.proname, args;

\echo '=== 15 ORPHAN-PRONE FKs (nullable col or NO ACTION/RESTRICT) ==='
SELECT n.nspname AS sch, cl.relname AS tbl, con.conname AS fk_name,
       (SELECT string_agg(a.attname || CASE WHEN a.attnotnull THEN '' ELSE ' [NULLABLE]' END, ', ' ORDER BY u.ord)
        FROM unnest(con.conkey) WITH ORDINALITY u(attnum,ord) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=u.attnum) AS fk_columns,
       CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete,
       (SELECT n2.nspname||'.'||c2.relname FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid=c2.relnamespace WHERE c2.oid=con.confrelid) AS ref_table,
       (SELECT bool_or(NOT a.attnotnull) FROM unnest(con.conkey) k(attnum) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum) AS has_nullable
FROM pg_constraint con
JOIN pg_class cl ON cl.oid=con.conrelid
JOIN pg_namespace n ON n.oid=cl.relnamespace
WHERE n.nspname IN ('smartgov','public') AND con.contype='f'
  AND (con.confdeltype IN ('a','r') OR EXISTS (SELECT 1 FROM unnest(con.conkey) k(attnum) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum WHERE NOT a.attnotnull))
ORDER BY n.nspname, cl.relname, con.conname;

\echo '=== 16 ALL FKs SUMMARY (for reference) ==='
SELECT n.nspname AS sch, cl.relname AS tbl, con.conname AS fk_name,
       (SELECT string_agg(a.attname,',' ORDER BY u.ord) FROM unnest(con.conkey) WITH ORDINALITY u(attnum,ord) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=u.attnum) AS cols,
       CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace
WHERE n.nspname IN ('smartgov','public') AND con.contype='f'
ORDER BY 1,2,3;

\echo '=== 17 MISSING FK CANDIDATES (*_id columns without FK) ==='
SELECT n.nspname AS sch, c.relname AS tbl, a.attname AS col, format_type(a.atttypid,a.atttypmod) AS typ,
       CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULLABLE' END AS nullability
FROM pg_attribute a
JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('smartgov','public') AND c.relkind IN ('r','p')
  AND a.attnum>0 AND NOT a.attisdropped
  AND (a.attname LIKE '%\_id' ESCAPE '\' OR a.attname IN ('created_by','updated_by','granted_by','uploaded_by','verified_by','requested_by','decided_by','actor_id','deactivated_by','deactivation_scheduled_by','confirmed_by'))
  AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conrelid=c.oid AND con.contype='f' AND a.attnum=ANY(con.conkey))
ORDER BY 1,2,3;

\echo '=== 18 FKs WITHOUT LEADING INDEX ==='
WITH fkc AS (
  SELECT con.oid, con.conrelid, con.conname, array_agg(a.attname ORDER BY u.ord) AS cols, count(*) AS ncols
  FROM pg_constraint con
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY u(attnum,ord)
  JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=u.attnum
  WHERE con.contype='f' AND con.connamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('smartgov','public'))
  GROUP BY con.oid, con.conrelid, con.conname
), idx AS (
  SELECT i.indrelid, array_agg(a.attname ORDER BY u.ord) AS cols
  FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY u(attnum,ord)
  JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=u.attnum
  GROUP BY i.indrelid, i.indexrelid
)
SELECT n.nspname AS sch, cl.relname AS tbl, f.conname AS fk_name, f.cols AS fk_cols,
       EXISTS (SELECT 1 FROM idx WHERE idx.indrelid=f.conrelid AND idx.cols[1:f.ncols]=f.cols) AS has_leading_index
FROM fkc f JOIN pg_class cl ON cl.oid=f.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace
WHERE NOT EXISTS (SELECT 1 FROM idx WHERE idx.indrelid=f.conrelid AND idx.cols[1:f.ncols]=f.cols)
ORDER BY 1,2,3;

\echo '=== 19 RLS ENABLED BUT ZERO POLICIES ==='
SELECT n.nspname AS sch, c.relname AS tbl, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('smartgov','public') AND c.relkind IN ('r','p') AND c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid)
ORDER BY 1,2;

\echo '=== 20 STATUS COLUMNS WITHOUT CHECK CONSTRAINT ==='
SELECT n.nspname AS sch, c.relname AS tbl, a.attname AS col, format_type(a.atttypid,a.atttypmod) AS typ
FROM pg_attribute a
JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('smartgov','public') AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
  AND (a.attname LIKE '%status%' OR a.attname LIKE '%state%')
  AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conrelid=c.oid AND con.contype='c' AND a.attnum=ANY(con.conkey))
ORDER BY 1,2,3;

\echo '=== 21 SMARTGOV FUNCTIONS WITHOUT SAME-NAME PUBLIC FUNCTION ==='
SELECT s.proname AS fn, pg_get_function_identity_arguments(s.oid) AS args
FROM pg_proc s JOIN pg_namespace sn ON sn.oid=s.pronamespace
WHERE sn.nspname='smartgov'
  AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE pn.nspname='public' AND p.proname=s.proname)
ORDER BY 1,2;

\echo '=== 22 PUBLIC FUNCTIONS REFERRING TO NONEXISTENT SMARTGOV FUNCTION ==='
WITH refs AS (
  SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args, m[1] AS ref
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL regexp_matches(pg_get_functiondef(p.oid),'smartgov\.([a-zA-Z_][a-zA-Z0-9_]*)','g') m
  WHERE n.nspname='public'
)
SELECT r.proname AS wrapper, r.args, r.ref AS missing_smartgov_fn
FROM refs r
WHERE NOT EXISTS (SELECT 1 FROM pg_proc q JOIN pg_namespace sn ON sn.oid=q.pronamespace WHERE sn.nspname='smartgov' AND q.proname=r.ref)
ORDER BY 1,2,3;

\echo '=== 23 FUNCTIONS WITHOUT PUBLIC EXECUTE ==='
SELECT n.nspname AS sch, p.proname AS fn, pg_get_function_identity_arguments(p.oid) AS args,
       p.proacl IS NULL AS acl_null_default,
       has_function_privilege(p.oid,'PUBLIC','EXECUTE') AS public_execute,
       has_function_privilege(p.oid,'anon','EXECUTE') AS anon_execute,
       has_function_privilege(p.oid,'authenticated','EXECUTE') AS auth_execute,
       has_function_privilege(p.oid,'service_role','EXECUTE') AS service_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('smartgov','public')
  AND NOT has_function_privilege(p.oid,'PUBLIC','EXECUTE')
ORDER BY 1,2,3;

\echo '=== 24 TABLE USAGE STATS ==='
SELECT n.nspname AS sch, s.relname AS tbl,
       s.seq_scan, s.idx_scan, s.n_tup_ins, s.n_tup_upd, s.n_tup_del,
       s.last_seq_scan, s.last_idx_scan
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid=s.relid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('smartgov','public')
ORDER BY 1,2;

\echo '=== 24b FUNCTION TRACKING SETTING + FUNCTION STATS ==='
SELECT current_setting('track_functions') AS track_functions;
SELECT count(*) AS function_stat_rows FROM pg_stat_user_functions;
```

### 04_fix.sql

```sql
\echo '=== 23 FUNCTIONS WITHOUT PUBLIC EXECUTE (ACL-based) ==='
SELECT n.nspname AS sch, p.proname AS fn, pg_get_function_identity_arguments(p.oid) AS args,
       CASE WHEN p.proacl IS NULL THEN 'DEFAULT(PUBLIC EXECUTE)' ELSE 'EXPLICIT' END AS acl_mode,
       (SELECT string_agg(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type, ',' ORDER BY 1)
        FROM aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE') AS execute_grantees
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('smartgov','public')
  AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
ORDER BY 1,2,3;

\echo '=== 24 TABLE USAGE STATS ==='
SELECT n.nspname AS sch, s.relname AS tbl,
       s.seq_scan, s.idx_scan, s.n_tup_ins, s.n_tup_upd, s.n_tup_del,
       s.last_seq_scan, s.last_idx_scan
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid=s.relid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('smartgov','public')
ORDER BY 1,2;

\echo '=== 24b FUNCTION TRACKING SETTING + STATS ==='
SELECT current_setting('track_functions') AS track_functions;
SELECT count(*) AS function_stat_rows FROM pg_stat_user_functions;

\echo '=== 25 DEFINITIONS OF SUSPECT WRAPPERS ==='
SELECT p.proname, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('list_requirement_answer_versions','resolve_account')
ORDER BY p.proname;
```

### 05_final.sql

```sql
\echo '=== 26 EXACT ROW COUNTS (read-only SELECT count(*)) ==='
SELECT format('SELECT %L AS sch, %L AS tbl, count(*) AS exact_rows FROM %I.%I;', n.nspname, c.relname, n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('smartgov','public') AND c.relkind IN ('r','p')
ORDER BY n.nspname, c.relname
\gexec

\echo '=== 27 RAW reltuples (negative = never analyzed) ==='
SELECT n.nspname AS sch, c.relname AS tbl, c.reltuples AS raw_reltuples
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('smartgov','public') AND c.relkind IN ('r','p')
ORDER BY 1,2;

\echo '=== 28 PUBLIC WRAPPER INVENTORY (focused) ==='
SELECT p.proname AS wrapper,
       pg_get_function_identity_arguments(p.oid) AS args,
       CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS sec,
       COALESCE(array_to_string(p.proconfig,'; '),'(NONE)') AS search_path,
       (SELECT string_agg(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,',' ORDER BY 1)
        FROM aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE') AS exec_grantees,
       EXISTS (SELECT 1 FROM pg_proc q JOIN pg_namespace sn ON sn.oid=q.pronamespace WHERE sn.nspname='smartgov' AND q.proname=p.proname) AS same_name_smartgov_fn,
       COALESCE((SELECT string_agg(DISTINCT m[1],',' ORDER BY m[1]) FROM regexp_matches(pg_get_functiondef(p.oid),'smartgov\.([a-zA-Z_][a-zA-Z0-9_]*)','g') m),'') AS smartgov_refs
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
ORDER BY p.proname, args;

\echo '=== 29 SECURITY DEFINER FUNCTIONS WITH NO search_path SET ==='
SELECT n.nspname AS sch, p.proname AS fn, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('smartgov','public') AND p.prosecdef AND p.proconfig IS NULL
ORDER BY 1,2,3;

\echo '=== 30 DEAD FUNCTION CANDIDATES (no wrapper, not referenced by any other smartgov/public function) ==='
WITH defs AS (
  SELECT oid, pg_get_functiondef(oid) AS d FROM pg_proc
  WHERE pronamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('smartgov','public'))
)
SELECT s.proname AS fn, pg_get_function_identity_arguments(s.oid) AS args, sn.nspname AS sch
FROM pg_proc s JOIN pg_namespace sn ON sn.oid=s.pronamespace
CROSS JOIN LATERAL (SELECT s.proname AS nm) n1
WHERE sn.nspname='smartgov'
  AND NOT EXISTS (SELECT 1 FROM pg_proc q JOIN pg_namespace pn ON pn.oid=q.pronamespace WHERE pn.nspname='public' AND q.proname=s.proname)
  AND NOT EXISTS (SELECT 1 FROM defs d WHERE d.oid<>s.oid AND d.d ~* ('smartgov\.' || n1.nm || '\s*\('))
ORDER BY 1,2;

\echo '=== 31 CHECK / UNIQUE CONSTRAINTS LIST ==='
SELECT n.nspname AS sch, cl.relname AS tbl, con.conname, con.contype, pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace
WHERE n.nspname IN ('smartgov','public') AND con.contype IN ('c','u','x')
ORDER BY 1,2,3;
```

### 06_verify.sql

```sql
\echo '=== 32 WRAPPERS ACCEPTING p_session_token BUT NOT REFERENCING IT ==='
SELECT p.proname AS fn,
       pg_get_function_identity_arguments(p.oid) AS args,
       CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS sec,
       COALESCE(array_to_string(p.proconfig,'; '),'(NONE)') AS config,
       (SELECT string_agg(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,',' ORDER BY 1)
        FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE') AS exec_grantees
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND pg_get_function_identity_arguments(p.oid) LIKE '%p_session_token%'
  AND pg_get_functiondef(p.oid) NOT LIKE '%p_session_token%'
ORDER BY 1,2;

\echo '=== 33 ANON EXECUTE ON SUSPECT RPCs ==='
SELECT p.proname AS fn,
       pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
       p.prosecdef AS security_definer,
       COALESCE(array_to_string(p.proconfig,'; '),'(NONE)') AS config
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('list_requirement_answer_versions','create_survey_otp','verify_survey_otp','add_survey_question','update_survey_question')
ORDER BY 1,2;

\echo '=== 34 LIVE ANON CALL: TOKEN IGNORED (no rows expected) ==='
BEGIN;
SET LOCAL ROLE anon;
SELECT public.list_requirement_answer_versions(
  'invalid-token',
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid
) AS anon_result;
ROLLBACK;
```

### 07_public_exec.sql

```sql
\echo '=== 35 PUBLIC-EXECUTE SECURITY DEFINER WRAPPERS ==='
SELECT p.proname AS fn,
       pg_get_function_identity_arguments(p.oid) AS args,
       COALESCE(array_to_string(p.proconfig,'; '),'(NONE)') AS config
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.prosecdef
  AND EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
ORDER BY 1,2;
```

### 08_survey_modes.sql

```sql
\echo '=== 36 SURVEY ACCESS MODE COUNTS ==='
SELECT access_mode, status, count(*) AS surveys FROM smartgov.surveys GROUP BY access_mode, status ORDER BY access_mode, status;
```

## Appendix B: evidence and limitations

Evidence files were named after the catalog scripts and their captured outputs: `00_probe` through `08_survey_modes`. Source evidence includes the two migration files named in the findings and the Next.js route/page files listed in F-02 and F-03.

The audit did not perform HTTP requests, authentication as an application user, state-changing RPC calls, or privilege changes. Several conclusions therefore use explicit statuses:

- **Confirmed** means supported by source, catalog metadata, or a read-only live query.
- **Pending validation** means the catalog finding is real, but business intent or runtime usage was not established.
- **No current exposure** means the relevant table currently has 0 rows or no affected configuration exists.
- **Residual risk** is listed where a stronger live proof was intentionally not attempted.
