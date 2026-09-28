# Email Uniqueness and Self-Service Email Change - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refuse registration for an address that is already in use, before anything is written, and let a signed-in user change their own email with a code sent to the new address, a warning in the UI, and a notice to the old one.

**Architecture:** One migration adds a `smartgov.email_changes` table, an `email_conflict_reason` helper, and six functions (one internal, five published through one-line `public` wrappers). Five route handlers and one dashboard client component consume them. Nothing is deployed until the SQL layer has been exercised against production.

**Tech Stack:** PostgreSQL via Supabase (pooler, `ap-southeast-2`), PostgREST RPC, Next.js 16 App Router, React 19, nodemailer, `HMAC-SHA256` OTP with `AUTH_PEPPER`.

**Design:** `docs/plans/2026-09-28-email-uniqueness-and-change-design.md`

---

## Standing constraints

These come from the existing codebase and are load-bearing. Do not relax them.

1. **New logic goes in `smartgov`, never in `public`.** A `public` function is a one-line `security definer` forwarder. Logic inside a wrapper is how the pgcrypto bug happened (`README:136`).
2. **`set search_path = public, extensions, smartgov, pg_temp` on every function.** pgcrypto is installed in `extensions`, not `public`. Schema-qualify `extensions.crypt`, `extensions.digest`, `extensions.gen_random_bytes`.
3. **Take a session token, never an account id.** An account id is an enumerable uuid (`README:127`, `README:172-174`).
4. **Charge `consume_rate_limit` inside the function**, so a direct PostgREST caller is bound too (`README:196`).
5. **Grant `execute` explicitly.** No `grant execute on all functions in schema`.
6. **No table policy, no table grant, no direct client read.** New table -> new function + wrapper + grant. RLS on, zero policies.
7. **Never return a `reason` to the client.** Routes map it through `messageFor` (`src/lib/auth/messages.ts`).
8. **Every interpolated value in an email template goes through `esc()`.** `src/lib/mail/templates.ts:13-15`.
9. **Store the OTP hash before sending.** A transport failure must leave a retryable row, never a lost code.

## No test framework

There is no runner, no CI, and no test directory in this repo. Every previous migration was verified with throwaway scripts against production Postgres. This plan keeps that shape and names the script for each step, so each step is independently checkable.

Two scripts are created in Task 1 and reused throughout. They live in the OS temp directory and are **never committed**; they contain the pooler password.

- `%TEMP%\opencode\sgov_005\db.py` - connection helper, hard-codes the DSN
- `%TEMP%\opencode\sgov_005\check.py` - a named SQL snippet, run as `python check.py <name>`

Pooler DSN shape, which is the only one that resolves:

    host=aws-0-ap-southeast-2.pooler.supabase.com port=5432 dbname=postgres
    user=postgres.<project-ref> password=<from .env.local> sslmode=require

The project ref and the database password are **not** written into this plan.
Read both from `.env.local` at runtime, as `db.py` below does. Do not paste the
DSN into a file, a commit, or a report.

**Do not try `ap-southeast-1`.** It resolves and then returns `ENOTFOUND tenant`, which looks like a dead project. It is not. `ap-southeast-2` works.

## Production safety

Tasks 3 through 11 run against the live database. Before any of them:

- Confirm with the user that the migration may be applied.
- The database currently holds zero rows in all eight tables, so test data is easy to identify and purge.
- Never run a destructive statement without a matching assertion in the same script.

---

### Task 1: Set up the verification harness

**Files:**
- Create (temp, uncommitted): `%TEMP%\opencode\sgov_005\db.py`
- Create (temp, uncommitted): `%TEMP%\opencode\sgov_005\check.py`

**Step 1: Create the connection helper**

`%TEMP%\opencode\sgov_005\db.py`

```python
import os, pathlib, re, psycopg

# Read from the environment so the credential never lands in this file, in a
# commit, or in a report.
#
# The project ref is derivable from NEXT_PUBLIC_SUPABASE_URL, which is safe
# enough to read from .env.local. The DATABASE PASSWORD is NOT in .env.local -
# it has never been stored in the repo - so it must be supplied out of band,
# via the SGOV_DB_PASSWORD environment variable, the same way the previous
# apply scripts obtained it.
REPO = pathlib.Path(r"C:\Users\Julius M. Matro\Desktop\smartgov1")


def _env_file(name):
    for line in (REPO / ".env.local").read_text(encoding="utf-8").splitlines():
        m = re.match(rf"^{name}\s*=\s*(.+)$", line.strip())
        if m:
            return m.group(1).strip().strip('"')
    raise SystemExit(f"{name} is not in .env.local")


def _ref():
    url = _env_file("NEXT_PUBLIC_SUPABASE_URL")
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", url)
    if not m:
        raise SystemExit(f"cannot parse a project ref out of {url}")
    return m.group(1)


_pw = os.environ.get("SGOV_DB_PASSWORD")
if not _pw:
    raise SystemExit("set SGOV_DB_PASSWORD in the environment before running this")

# The pooler only accepts a direct connection for an already-open session, and
# only on ap-southeast-2. ap-southeast-1 resolves and then answers
# ENOTFOUND tenant, which reads exactly like a deleted project.
DSN = (
    "host=aws-0-ap-southeast-2.pooler.supabase.com port=5432 "
    f"dbname=postgres user=postgres.{_ref()} "
    f"password={_pw} sslmode=require connect_timeout=15"
)


def connect():
    return psycopg.connect(DSN, autocommit=True)



def run(cur, sql, args=None):
    cur.execute(sql, args or ())
    return cur.fetchall()


def scalar(cur, sql, args=None):
    rows = run(cur, sql, args)
    return rows[0][0] if rows else None
```

**Step 2: Create the snippet runner**

`%TEMP%\opencode\sgov_005\check.py`

```python
import sys, db

SNIPPETS = {}


def snippet(name):
    def deco(fn):
        SNIPPETS[name] = fn
        return fn
    return deco


@snippet("baseline")
def _baseline(cur):
    for t in ("public.organizations", "public.governance_units",
              "public.organization_members", "public.submissions",
              "smartgov.accounts", "smartgov.invites",
              "smartgov.sessions", "smartgov.rate_limits"):
        print(f"  {t:32s} {db.scalar(cur, f'select count(*) from {t}')}")
    print("  migrations:",
          [r[0] for r in db.run(cur, "select version from supabase_migrations.schema_migrations order by version")])


if __name__ == "__main__":
    name = sys.argv[1]
    if name not in SNIPPETS:
        print(f"unknown snippet {name}; have {sorted(SNIPPETS)}")
        sys.exit(2)
    c = db.connect()
    with c.cursor() as cur:
        SNIPPETS[name](cur)
```

**Step 3: Verify the harness connects and print the baseline**

Run: `python check.py baseline`
Expected: all eight tables at `0`, and five migration versions ending `20260101000400`.

**Step 4: Commit**

Nothing. These files are in the temp directory and are never staged. Verify with
`git status --short` - it must show a clean tree.

---

### Task 2: Write the migration

**Files:**
- Create: `supabase/migrations/20260101000500_email_uniqueness_and_change.sql`

Read `supabase/migrations/20260101000300_expose_auth_api_and_hardening.sql` in
full first. It is the template for every convention this task has to satisfy.

**Step 1: Schema, enum, indexes, RLS**

```sql
-- Email self-service. An account changing its own address needs its own state,
-- separate from the invite OTP: that machinery is keyed on the invite token,
-- resolves the account by email, and only ever writes to pending accounts.

do $$ begin
  create type smartgov.email_change_status as enum
    ('pending', 'verified', 'cancelled', 'expired');
exception when duplicate_object then null; end $$;

create table if not exists smartgov.email_changes (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references smartgov.accounts (id) on delete cascade,
  old_email        text not null,
  new_email        text not null,
  otp_hash         text,
  otp_expires_at   timestamptz,
  otp_attempts     smallint not null default 0,
  otp_resends      integer not null default 0,
  otp_last_sent_at timestamptz,
  status           smartgov.email_change_status not null default 'pending',
  created_at       timestamptz not null default now(),
  verified_at      timestamptz
);

-- One live change per account. Starting a new change replaces the old one, so
-- without this a second start would collide with the first.
create unique index if not exists email_changes_pending_uniq
  on smartgov.email_changes (account_id) where status = 'pending';

-- Two accounts cannot both hold a claim on the same target. Without this the
-- first to verify wins and the second fails on accounts_email_uniq at the swap,
-- with nothing to show for it.
create unique index if not exists email_changes_new_uniq
  on smartgov.email_changes (new_email) where status = 'pending';

create index if not exists email_changes_resend_idx
  on smartgov.email_changes (otp_last_sent_at);

alter table smartgov.email_changes enable row level security;

revoke all on smartgov.email_changes from anon, authenticated;
```

**Step 2: The conflict helper**

```sql
-- One place that decides whether an address is spoken for, so the probe, the
-- organization create and the account create cannot drift apart. A pending
-- claim counts as taken: otherwise the reservation means nothing.
create or replace function smartgov.email_conflict_reason(p_email text)
returns text language sql stable
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce((
    select case a.status
             when 'active'    then 'email_taken'
             when 'suspended' then 'account_suspended'
             else 'invite_pending'
           end
    from smartgov.accounts a
    where lower(a.email) = lower(trim(coalesce(p_email, '')))
    union all
    select 'email_taken'
    from smartgov.email_changes c
    where c.status = 'pending'
      and lower(c.new_email) = lower(trim(coalesce(p_email, '')))
    limit 1
  ), '');
$$;
```

**Step 3: `check_email_available` and its wrapper**

Rate limited, because a distinguishable answer per address is an enumeration
oracle. The limit is per address *and* per window, so a scanner walking a list
still runs out.

```sql
create or replace function smartgov.check_email_available(p_email text)
returns jsonb language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_reason text;
begin
  if v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  if not smartgov.consume_rate_limit('check:email:' || v_email, 10, interval '10 minutes')
     or not smartgov.consume_rate_limit('check:global', 500, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_reason := smartgov.email_conflict_reason(v_email);

  return jsonb_build_object(
    'ok', true,
    'available', v_reason = '',
    'reason', nullif(v_reason, '')
  );
end $$;

create or replace function public.check_email_available(p_email text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.check_email_available(p_email); $$;

grant execute on function public.check_email_available(text) to anon, authenticated;
```

**Step 4: `begin_email_change` and its wrapper**

```sql
create or replace function smartgov.begin_email_change(
  p_session_token text, p_password text, p_new_email text
) returns jsonb language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts;
  v_new     text := lower(trim(coalesce(p_new_email, '')));
  v_reason  text;
begin
  if p_session_token is null or p_session_token = '' then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select a.* into v_account
  from smartgov.sessions s
  join smartgov.accounts a on a.id = s.account_id
  where s.token_hash = smartgov.sha256(p_session_token)
    and s.expires_at > now()
    and a.status = 'active';

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  -- Re-auth. The session cookie is httpOnly, so it is the only thing standing
  -- between a stolen cookie and an account whose recovery address the attacker
  -- now controls.
  if not smartgov.password_matches(coalesce(p_password, ''), v_account.password_hash) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  if v_new = '' or position('@' in v_new) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  if v_new = lower(v_account.email) then
    return jsonb_build_object('ok', false, 'reason', 'same_email');
  end if;

  if not smartgov.consume_rate_limit('emailchange:' || v_account.id::text, 5, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_reason := smartgov.email_conflict_reason(v_new);
  if v_reason <> '' then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  -- No scheduler in this project, so the housekeeping rides along with the one
  -- call that already reads this table.
  update smartgov.email_changes
     set status = 'expired'
   where status = 'pending' and created_at < now() - interval '7 days';

  -- Starting again abandons the previous attempt, which also releases the
  -- address it was holding.
  update smartgov.email_changes
     set status = 'cancelled'
   where account_id = v_account.id and status = 'pending';

  insert into smartgov.email_changes (account_id, old_email, new_email)
  values (v_account.id, lower(v_account.email), v_new);

  return jsonb_build_object('ok', true, 'expiresInMinutes', 15);
end $$;

create or replace function public.begin_email_change(text, text, text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.begin_email_change($1, $2, $3); $$;

grant execute on function public.begin_email_change(text, text, text) to anon, authenticated;
```

Note the wrapper is written with unnamed parameters so the signature is
`begin_email_change(text, text, text)`. `begin` is not a reserved word in this
position, but if the parser objects, rename to `start_email_change` in both the
function and the wrapper. Do not leave the two names mismatched.

**Step 5: `set_email_change_otp` and its wrapper**

The cap is on the row, not in a window, for the same reason the invite cap is:
a window would be spent again and again, so it would not bound anything.

```sql
create or replace function smartgov.set_email_change_otp(
  p_session_token text, p_otp_hash text, p_ttl_minutes integer default 15
) returns boolean language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts;
  v_change  smartgov.email_changes;
begin
  if p_session_token is null or p_session_token = '' then
    return false;
  end if;

  select a.* into v_account
  from smartgov.sessions s
  join smartgov.accounts a on a.id = s.account_id
  where s.token_hash = smartgov.sha256(p_session_token)
    and s.expires_at > now() and a.status = 'active';

  if not found then return false; end if;

  select c.* into v_change
  from smartgov.email_changes c
  where c.account_id = v_account.id and c.status = 'pending'
  for update;

  if not found then return false; end if;

  if v_change.otp_resends >= 5 then return false; end if;

  if v_change.otp_last_sent_at is not null
     and v_change.otp_last_sent_at > now() - interval '2 minutes' then
    return false;
  end if;

  update smartgov.email_changes
     set otp_hash        = p_otp_hash,
         otp_expires_at  = now() + make_interval(mins => greatest(1, least(coalesce(p_ttl_minutes, 15), 60))),
         otp_attempts    = 0,
         otp_resends     = otp_resends + 1,
         otp_last_sent_at = now()
   where id = v_change.id;

  return true;
end $$;

create or replace function public.set_email_change_otp(text, text, integer)
returns boolean language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_email_change_otp($1, $2, $3); $$;

grant execute on function public.set_email_change_otp(text, text, integer) to anon, authenticated;
```

**Step 6: `verify_email_change` and its wrapper**

The swap is the only irreversible part, so it re-checks the conflict and catches
the unique violation. It also revokes every session except the one making the
call, and carries the founding member row with it.

```sql
create or replace function smartgov.verify_email_change(
  p_session_token text, p_code_hash text
) returns jsonb language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts;
  v_change  smartgov.email_changes;
  v_reason  text;
  v_left    integer;
begin
  if p_session_token is null or p_session_token = '' or p_code_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select a.* into v_account
  from smartgov.sessions s
  join smartgov.accounts a on a.id = s.account_id
  where s.token_hash = smartgov.sha256(p_session_token)
    and s.expires_at > now() and a.status = 'active';

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select c.* into v_change
  from smartgov.email_changes c
  where c.account_id = v_account.id and c.status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_pending_change');
  end if;

  if not smartgov.consume_rate_limit(
         'emailchange:verify:' || v_change.id::text, 20, interval '15 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Re-checked, not trusted from begin(): a reservation can still lose a race
  -- against an address claimed some other way in the gap.
  v_reason := smartgov.email_conflict_reason(v_change.new_email);
  if v_reason <> '' then
    update smartgov.email_changes set status = 'cancelled' where id = v_change.id;
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  if v_change.otp_hash is null or v_change.otp_expires_at is null
     or v_change.otp_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'otp_expired');
  end if;

  if v_change.otp_attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  if v_change.otp_hash <> p_code_hash then
    update smartgov.email_changes
       set otp_attempts = otp_attempts + 1
     where id = v_change.id;
    select greatest(0, 5 - otp_attempts) into v_left
    from smartgov.email_changes where id = v_change.id;
    return jsonb_build_object('ok', false, 'reason', 'otp_mismatch', 'attemptsLeft', v_left);
  end if;

  begin
    update smartgov.accounts set email = v_change.new_email
     where id = v_account.id;

    -- The founding member row is the proof create_owner_account checks. If it
    -- keeps the old address it stops matching the account it belongs to.
    update public.organization_members m
       set email = v_change.new_email
      from smartgov.accounts a
     where a.id = v_account.id
       and m.organization_id = a.organization_id
       and m.email = v_change.old_email
       and m.is_founding;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'email_taken');
  end;

  update smartgov.email_changes
     set status = 'verified', verified_at = now(), otp_hash = null
   where id = v_change.id;

  -- The address just changed is the recovery path, so every other device is
  -- let go. The calling session survives.
  delete from smartgov.sessions
   where account_id = v_account.id
     and token_hash <> smartgov.sha256(p_session_token);

  return jsonb_build_object('ok', true, 'email', v_change.new_email);
end $$;

create or replace function public.verify_email_change(text, text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.verify_email_change($1, $2); $$;

grant execute on function public.verify_email_change(text, text) to anon, authenticated;
```

**Step 7: `cancel_email_change` and its wrapper**

```sql
create or replace function smartgov.cancel_email_change(p_session_token text)
returns boolean language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts;
begin
  if p_session_token is null or p_session_token = '' then
    return false;
  end if;

  select a.* into v_account
  from smartgov.sessions s
  join smartgov.accounts a on a.id = s.account_id
  where s.token_hash = smartgov.sha256(p_session_token)
    and s.expires_at > now() and a.status = 'active';

  if not found then return false; end if;

  -- Otherwise the target address stays locked with nothing to release it.
  update smartgov.email_changes
     set status = 'cancelled'
   where account_id = v_account.id and status = 'pending';

  return found;
end $$;

create or replace function public.cancel_email_change(text)
returns boolean language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.cancel_email_change($1); $$;

grant execute on function public.cancel_email_change(text) to anon, authenticated;
```

**Step 8: Restate the grants for accounts and email_changes**

Copy the grant block style from `20260101000300_...sql:702-714`. Assert
`anon` and `authenticated` hold no `select`/`insert`/`update`/`delete` on
`smartgov.accounts` or `smartgov.email_changes`.

**Step 9: Parse-check without applying**

Run:

```powershell
npx --yes sql-formatter --version
```

If unavailable, skip to Step 10 - the apply in Task 3 is the real check.

**Step 10: Commit**

```powershell
git add supabase/migrations/20260101000500_email_uniqueness_and_change.sql
git commit -m "Add email self-service and a shared email-conflict check"
```

---

### Task 3: Apply the migration to production

**Files:**
- Modify (temp): `%TEMP%\opencode\sgov_005\apply.py`
- Verify: `supabase_migrations.schema_migrations`

**Step 1: Ask the user before touching production**

State plainly that this creates a table and six functions, changes no existing
behaviour, and that the two behavioural changes land in Tasks 5 and 6.

**Step 2: Confirm the ledger is still in step with the files**

Run: `python check.py baseline`
Expected: five versions, `20260101000000` through `20260101000400`.

**Step 3: Apply inside a transaction**

`%TEMP%\opencode\sgov_005\apply.py` reads the migration file, splits on
`;\n` boundaries the way the previous apply scripts did, executes each
statement, and rolls back on any failure. Do not paste into the dashboard: the
SQL Editor and `db push` must not both be used for the same file
(`README:111`), because the CLI will then try to replay it.

**Step 4: Record it in the ledger**

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260101000500', 'email_uniqueness_and_change', array['manual-apply'])
on conflict (version) do nothing;
```

**Step 5: Confirm all six wrappers exist and are grantable**

```sql
select p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('check_email_available','begin_email_change','set_email_change_otp',
   'verify_email_change','cancel_email_change')
order by p.proname;
```
Expected: five rows. If `begin_email_change` is missing, it was a reserved
word - rename it as noted in Task 2 Step 4.

**Step 6: Confirm the search_path is pinned on all five**

Same query, plus `p.proconfig`. Every row must contain `extensions`.

**Step 7: Confirm nothing leaked**

Re-run the grant and RLS checks from Task 2 Step 8, plus
`anon`/`authenticated` table privileges on `smartgov.email_changes`. Expected:
no CRUD on any of the eight tables.

---

### Task 4: Verify the conflict helper and the probe

**Files:**
- Modify (temp): `%TEMP%\opencode\sgov_005\check.py`

**Step 1: Add a `conflict` snippet** that inserts one account per status into a
transaction, calls `smartgov.email_conflict_reason` for each, asserts the
expected code, and rolls back.

| Fixture | Expected |
|---|---|
| no rows | `''` |
| `active` account | `email_taken` |
| `pending` account | `invite_pending` |
| `suspended` account | `account_suspended` |
| pending `email_changes` row | `email_taken` |
| `MiXeD@Case` vs stored `mixed@case` | `email_taken` |
| trailing space | `email_taken` |

**Step 2: Run it**

Run: `python check.py conflict`
Expected: all seven rows match, and the script reports `ROLLBACK`.

**Step 3: Add a `probe` snippet** that calls `smartgov.check_email_available`
for a free address and for each fixture, asserting `available` and `reason`,
and that the 11th call in a window returns `rate_limited`.

Run: `python check.py probe`
Expected: available for the free one, correct `reason` for the fixtures, and
`rate_limited` on call 11. Clean the `check:*` buckets afterwards.

---

### Task 5: Stop the orphan organization

**Files:**
- Modify: `supabase/migrations/20260101000500_email_uniqueness_and_change.sql`
  (append; the file has not been applied to any deployed environment yet, so it
  is amended in place and Tasks 3 to 4 are re-run)

**Step 1: Read the current `create_organization`**

`supabase/migrations/20260101000400_harden_create_organization.sql`, in full.
The order is: payload validation (`22023`), rate limits, unit check, insert org,
insert unit, insert founding member.

**Step 2: Add the conflict check after the rate limits**

Deliberately after, not before. `login_account` mints a token before checking
the password specifically so a wrong guess still costs a row write
(`20260101000300_...sql:280-282`); the same reasoning applies here. A rate
limit should bound rejected attempts too, otherwise it bounds nothing.

```sql
  -- An address that already has an account must not mint a fresh organization
  -- and a fresh founding member row every time somebody walks the wizard
  -- again. The account is refused later by create_owner_account, by which point
  -- the organization has already been written.
  v_conflict := smartgov.email_conflict_reason(v_email);
  if v_conflict <> '' then
    raise exception 'That email address is already in use.'
      using errcode = 'P0001';
  end if;
```

Declare `v_conflict text;` with the other locals. `create_organization` uses
SQLSTATE rather than reason codes throughout, so an exception is consistent
here - the route maps it in Task 9.

**Step 3: Re-apply and re-verify**

Re-run Task 3, then Task 4. Both must still pass.

**Step 4: Verify the orphan is actually gone**

Add a `no_orphan` snippet: with an `active` account on the address, call
`public.create_organization` and assert it raises, then assert
`public.organizations` gained no row.

**Step 5: Verify the happy path still works**

Add a `org_ok` snippet: with a free address, create an organization and assert
one organization, one unit, one founding member. Roll back.

**Step 6: Commit**

```powershell
git add supabase/migrations/20260101000500_email_uniqueness_and_change.sql
git commit -m "Refuse to mint an organization for an address that already has an account"
```

---

### Task 6: Make the account check atomic and informative

**Files:**
- Modify: `supabase/migrations/20260101000500_email_uniqueness_and_change.sql`

**Step 1: Replace the bare exists-check in `create_owner_account`**

Currently `20260101000300_...sql:243-245`. Replace the `exists` test with the
shared helper, so a pending or suspended account gets its own reason instead of
a misleading "already has an account".

```sql
  v_conflict := smartgov.email_conflict_reason(v_email);
  if v_conflict <> '' then
    return jsonb_build_object('ok', false, 'reason', v_conflict);
  end if;
```

**Step 2: Wrap the insert so the race stops being a 500**

The check-then-insert is not atomic. `accounts_email_uniq` is the real
backstop, and today a collision escapes as `23505` and reaches the client as a
generic HTTP 500.

```sql
  begin
    insert into smartgov.accounts (...) values (...);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'email_taken');
  end;
```

Keep the existing `v_conflict` declaration order and the F1 founding-member
check exactly as it is. Do not reorder the guards: `weak_password` and
`missing_name` intentionally still precede `email_taken`.

**Step 3: Re-apply and re-verify**

Task 3, then Task 4.

**Step 4: Verify the reason matrix through the real function**

Add an `owner` snippet calling `public.create_owner_account` against each
fixture and asserting the reason code. Include a malformed email, a short
password, a foreign `organizationId`, and a matching one.

**Step 5: Commit**

```powershell
git commit -am "Return a reason for every kind of taken address, and survive the race"
```

---

### Task 7: Map the new reasons

**Files:**
- Modify: `src/lib/auth/messages.ts:18`

**Step 1: Add two entries to `RPC_MESSAGES`**

```ts
  invite_pending:
    "You have a pending invitation at this address. Sign in and enter the code we emailed you.",
  account_suspended: "This account is suspended. Please contact your officer.",
```

Also add `same_email` and `no_pending_change`, both from this migration:

```ts
  same_email: "That is already the email address on your account.",
  no_pending_change: "There is no email change waiting to be confirmed.",
```

**Step 2: Confirm no route ever echoes a reason**

`messageFor` already falls back to a generic string for unknown codes. Verify
no new route returns `reason` in its JSON.

**Step 3: Typecheck and lint**

Run: `npx tsc --noEmit` then `npx eslint .`
Expected: both clean.

**Step 4: Commit**

```powershell
git commit -am "Give the new refusal reasons a message"
```

---

### Task 8: The two email templates

**Files:**
- Modify: `src/lib/mail/templates.ts` (after `otpEmail`, `:254`)

**Step 1: Add `emailChangeCodeEmail`**

Model it on `otpEmail`. Signature:

```ts
export function emailChangeCodeEmail(opts: {
  to: string;
  code: string;
  newEmail: string;
  organizationName: string;
  minutes: number;
}): BrandedMail
```

Copy must be specific to this flow, and must not reuse the invite wording. The
`otpEmail` footnote - that the code is useless without the password just set -
is actively wrong here, because the reader is already signed in. State instead
that the code only works if the person requesting the change is the one reading
the mail.

Every interpolated value through `esc()`. The `code` is six digits, so it is
safe in the subject line, but pass it through `esc()` anyway.

**Step 2: Add `emailChangedNoticeEmail`**

```ts
export function emailChangedNoticeEmail(opts: {
  to: string;
  newEmail: string;
  displayName: string;
  organizationName: string;
  when: string;
}): BrandedMail
```

This is the security notice, so it must lead with the fact and say what to do
if it was not them. No code, no button - it is a terminal notification.

**Step 3: Confirm `esc()` covers everything**

Check both functions for interpolated values that do not go through `esc()`.
Check no caller-supplied URL reaches an `href`, because `button()` HTML-escapes
the href and does not validate the scheme.

**Step 4: Typecheck and lint**

**Step 5: Commit**

```powershell
git commit -am "Add the email-change code and the changed-address notice"
```

---

### Task 9: The five route handlers

**Files:**
- Create: `src/app/api/account/email-check/route.ts`
- Create: `src/app/api/account/email/change/route.ts`
- Create: `src/app/api/account/email/verify/route.ts`
- Create: `src/app/api/account/email/resend/route.ts`
- Create: `src/app/api/account/email/cancel/route.ts`

Read `src/app/api/invites/accept/route.ts` and
`src/app/api/invites/resend-code/route.ts` first; these follow them closely.

**Step 1: `email-check`**

Per-IP limit 20 per 10 min. Body `{ email }`. Call
`check_email_available`, return `{ ok: true, available, reason }` with the
reason already passed through `messageFor`. Never return the raw reason.

**Step 2: `email/change`**

Per-IP limit 5 per 15 min. Body `{ password, newEmail }`.

Order matters:
1. `begin_email_change(session, password, newEmail)` - on `!ok`, return
   `messageFor(reason)` with 400, or 401 for `invalid_credentials`.
2. `const code = otpCode()`
3. `set_email_change_otp(session, hmacOtp(code), 15)` - on `false`, return 409
   (`too_many_resends` or the 2-minute cooldown).
4. `await sendBranded(emailChangeCodeEmail({...}))` - on throw, return
   `{ ok: false, delivered: false, canResend: true }` with 502. **The row stays
   pending, which is the point.**
5. Return `{ ok: true, maskedNewEmail: maskEmail(newEmail), expiresInMinutes: 15 }`

The plaintext code is never in a response.

**Step 3: `email/verify`**

Per-IP limit 20 per 10 min. Body `{ code }` - strip non-digits, require exactly
6, as `invites/verify-otp/route.ts:41-53` does. Call `verify_email_change`. On
success return `{ ok: true, email }`. On `email_taken` return 409.

**Step 4: `email/resend`**

Per-IP limit 6 per 15 min, mirroring `resend-code`. Re-mint, re-store, re-send.
On `set_email_change_otp` returning false, 409.

**Step 5: `email/cancel`**

Per-IP limit 10 per 15 min. No body. Call `cancel_email_change`. Return
`{ ok: true }` regardless of whether a change existed - this is idempotent by
intent, so a double click cannot error.

**Step 6: Every handler**

- `readSessionToken()` for the session
- `messageFor(reason)`, never the reason itself
- `429` plus `Retry-After` for any rate limit
- `export const runtime = "nodejs"` where mail is sent

**Step 7: Confirm the Supabase client is still out of the browser**

Run: `npx next build`, then grep the emitted static chunks for `supabase` or
`postgrest`. Expected: no match.

**Step 8: Typecheck, lint, build, commit**

```powershell
git add src/app/api/account
git commit -am "Add the email-change and email-availability routes"
```

---

### Task 10: The dashboard control

**Files:**
- Create: `src/components/dashboard/ChangeEmailPanel.tsx`
- Modify: `src/components/auth/OtpVerify.tsx` (parameterise)
- Modify: `src/app/dashboard/page.tsx:162-179` (mount it)

**Step 1: Read the host**

`src/app/dashboard/page.tsx` around `:95-104` and `:162-179`. The panel is a
read-only `<dl>` in a server component, fed by `rows`, which already has
`["Account", data.email]`.

**Step 2: Read the pattern to copy**

`src/components/dashboard/SignOutButton.tsx`, all 27 lines. That is the size of
a client island in this dashboard and the shape to match.

**Step 3: Parameterise `OtpVerify`**

Add optional `verifyUrl` and `resendUrl` props, defaulting to the invite
endpoints, so the existing invite flow is untouched. Keep the 6-digit input and
the 30-second cooldown in one place rather than reimplementing them.

**Step 4: Build `ChangeEmailPanel`**

States: `idle`, `editing`, `sent`, `verified`, `error`.

The warning is a visible block **above** the form, and it must state all four
consequences, because three of them are irreversible:

> This replaces the address you sign in with.
> - The old address stops working, and becomes available for someone else to
>   register.
> - You will be signed out on every other device.
> - A notification will be sent to the old address.
> - You need your password to confirm.

Then the new-address input, then the password input, then submit.

`sent` state shows `OtpVerify` plus a resend link. On success call
`router.refresh()` so the server component re-reads `account_workspace` and
shows the new address.

**Step 5: Mount it in the Account panel**

Place it inside the existing `<section>`, below the `<dl>`. The `<dl>` is
server-rendered and stays read-only; the panel is the interactive part.

**Step 6: Verify the three states by hand**

```powershell
npm run dev
```

- Unverified: warning visible, form enabled, submit reachable
- Sent: code input only, resend disabled for 30 s
- Verified: panel returns to `idle`, `<dl>` shows the new address

**Step 7: Typecheck, lint, build, commit**

```powershell
git add src/components/dashboard/ChangeEmailPanel.tsx src/components/auth/OtpVerify.tsx src/app/dashboard/page.tsx
git commit -am "Let a signed-in user change their email, with the consequences stated first"
```

---

### Task 11: End-to-end verification, then purge

**Files:**
- Create (temp, uncommitted): `%TEMP%\opencode\sgov_005\e2e.mjs`

**Step 1: Write the live E2E against `https://sgov.vercel.app`**

It must assert, in order:

| # | Step | Assert |
|---|---|---|
| 1 | `POST /api/organization` with a fresh address | 200, `organizationId` |
| 2 | `POST /api/auth/register` | 200 |
| 3 | `POST /api/auth/login` | 200, cookie set |
| 4 | Open a **second** session for the same account, keep both tokens | two tokens |
| 5 | `POST /api/account/email/change` with a **wrong password** | 401 `invalid_credentials` |
| 6 | `POST /api/account/email/change` to an address that is `active` elsewhere | 400, taken |
| 7 | `POST /api/account/email/change` to its own address | 400, `same_email` |
| 8 | `POST /api/account/email/change`, correct password, free address | 200, no `code` in the body |
| 9 | DB: `select * from smartgov.email_changes` | one `pending` row, `otp_hash` set, `old_email` and `new_email` correct |
| 10 | `verify` with a wrong code | `otp_mismatch`, `attemptsLeft` 4 |
| 11 | DB: `otp_attempts` | 1 |
| 12 | `verify` with the right code | 200, `email` is the new address |
| 13 | DB: `accounts.email` | the new address |
| 14 | DB: `organization_members.email` where `is_founding` | the new address, followed the account |
| 15 | DB: sessions for the account | exactly one, the one that verified |
| 16 | The other token on `/dashboard` | 307, correctly signed out |
| 17 | The verifying token on `/dashboard` | 200, still signed in |
| 18 | `POST /api/account/email-check` for the **old** address | available, it was released |
| 19 | resend loop | 5 allowed, 6th refused |
| 20 | `POST /api/account/email/cancel` | 200, row `cancelled`, target address available again |
| 21 | `POST /api/organization` with the address of an `active` account | 400, **and no new organization row** |
| 22 | F1 regression: register against a foreign `organizationId` | 400 `not_organization_founder` |
| 23 | normal org creation with a free address | 200, one org, one unit, one member |

**Step 2: Run it**

Expected: all 23 pass. Fix and re-run on any failure - do not proceed to Step 3
with a failure outstanding.

**Step 3: Purge**

A single transaction deleting sessions, invites, accounts, submissions,
governance units, organization members, organizations, `email_changes` and
`rate_limits`. Then re-print all nine counts; every one must be 0.

**Step 4: Confirm the migrations survived**

`select version from supabase_migrations.schema_migrations order by version` -
six rows now, ending `20260101000500`.

**Step 5: Final live health check**

`/` 200, `/login` 200, `/dashboard` 307, `POST /api/auth/login` with bad
credentials 401, and the security headers still on all four.

---

### Task 12: Documentation and deploy

**Files:**
- Modify: `README.md`

**Step 1: Fix the stale migration list**

`README.md:99-104` lists four files and omits 004; `README:246` still says
"four files". It must list `20260101000000` through `20260101000500` and say
five, in the same one-line-per-file style already used.

**Step 2: Document the reason codes and the new buckets**

Add `invite_pending`, `account_suspended`, `same_email`, `no_pending_change` to
wherever the codes are listed. Add `check:email:`, `check:global`,
`emailchange:` and `emailchange:verify:` to the rate-limit table, including the
in-process per-IP numbers from Task 9.

**Step 3: Document the flow and its rules**

A short section: the password re-auth, that the old address is released rather
than reserved, that the other sessions are killed, and that the hash is stored
before the send. These are the four decisions that are not recoverable by
reading the code.

**Step 4: Re-check for secrets in the diff**

```powershell
git diff 80f1121..HEAD | Select-String -Pattern "Tonie3302|qyatedebfmupzntcltru|sb_publishable_[A-Za-z0-9_-]{20,}|sb_secret_|postgres(ql)?://"
```
Expected: no output.

**Step 5: Build, then deploy**

```powershell
npx tsc --noEmit
npx eslint .
npx next build
```

Then push and let Vercel build. Poll `https://sgov.vercel.app/` for
`X-Frame-Options: DENY` as the marker that the new build is live, the same way
the previous deploy was confirmed.

**Step 6: Post-deploy smoke test**

Re-run steps 1 to 3 and 22 to 23 of Task 11 only. Then purge again.

**Step 7: Commit**

```powershell
git commit -am "Document the email-change flow and the migration that carries it"
```

---

## Known-good state at the start of this plan

Recorded so the next agent can tell "already done" from "not done".

- `f7f4462` is live and `f9ce922` (the design doc) is pushed.
- All five migrations `00000` through `00400` are applied and recorded.
- All eight tables hold zero rows.
- The public attack surface is 15 functions; none of `authenticate`,
  `hash_password`, `password_matches`, `sha256` or `refresh_invite_status` is
  published.
- `anon` and `authenticated` hold no table CRUD; RLS is on with zero policies
  across all seven RLS-enabled tables.
- Production login answers `401` with a message, not `500`.
- The pooler works only on `ap-southeast-2`. The Supabase CLI token in this
  environment does **not** own the project, so `supabase projects list` does not
  show it and cannot be used to fetch a connection string.
- The Gmail app password in `.env.local` is known-exposed. It must be rotated
  before this feature ships, because a change-email notice that silently fails
  to send removes the entire account-recovery story.
