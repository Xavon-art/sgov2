# Owner Invite Actions (Cancel + Resend) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the owner dashboard per-invite **Cancel** (revoke, link dies) and **Resend** (fresh link, same invite) actions, plus an add-unit button that names the selected type.

**Architecture:** New migration `001500` adds two owner-only `smartgov` RPCs (`revoke_invite`, `resend_invite`) with thin `public` forwarders; two API routes (`/api/invites/cancel`, `/api/invites/resend`) mirror the existing invite-route patterns; `Workspace.tsx` replaces the `Activated` date column with an `Action` column (icon buttons + inline cancel confirm) and derives the add button label from the selected unit type.

**Tech Stack:** Next.js App Router (Node runtime), Supabase Postgres (PL/pgSQL RPCs), `callRpc`/`messageFor`/`canManageChart` from `src/lib/auth/*`, the repo's `sendBranded`/`inviteEmail` mail path. No new dependencies.

**Context notes for the implementer:** Worktree is `C:\Users\Julius M. Matro\Desktop\smartgov1\.worktrees\invite-actions` (branch `feature/invite-actions`), `npm ci` already ran. Shell is PowerShell 5.1 (no `&&`; use `; if ($?) { ... }`). There is **no jest/vitest** — verification is `scripts/check-units.mjs` (source-contract guards, 87 today), a temporary live-DB behavior script in `C:\Users\JULIUS~1.MAT\AppData\Local\Temp\opencode\` using `pg`, `npm run lint`, `npx tsc --noEmit`, `npm run build`. DB connection pattern (host `aws-0-ap-southeast-2.pooler.supabase.com`, user `postgres.qyatedebfmupzntcltru`, password `<DB_PASSWORD>`, db `postgres`, `ssl:{rejectUnauthorized:false}`). Keys: decisions in `docs/plans/2026-09-29-invite-actions-cancel-resend-design.md`. `invite_status` enum values: `pending | activated | expired | revoked`. Invite token is stored hashed (SHA-256); raw tokens are minted with `encode(gen_random_bytes(24),'hex')` and mailed. `list_invites` (00200:460) already hides `revoked`; `accept_invite_probe` (00200:585) rejects any `status <> 'pending'`.

---

### Task 1: Contract guards (failing first)

**Files:**
- Modify: `scripts/check-units.mjs` (append a new item group)
- Test: itself

**Step 1: Append guards.** After the existing groups, add an item that asserts (regex/grep over the new migration-agnostic statements... note this file has no DB connection; it lints the SQL source). For this task we guard the *shape* the migration must expose; keep it simple and assert on the intended migration filename's absence today to make it fail, then flip once 001500 lands:

```js
// (sketch — match the file's existing item/report conventions)
item("invite actions migration declares revoke + resend", () => {
  const sql = read("supabase/migrations/20260101001500_invite_cancel_and_resend.sql");
  assert.match(sql, /create or replace function smartgov\.revoke_invite/);
  assert.match(sql, /create or replace function smartgov\.resend_invite/);
  assert.match(sql, /set status = 'revoked'/);
  assert.match(sql, /token_hash = smartgov\.sha256\(v_raw\)/);
});
```

Follow the file's existing helpers (open it first — it uses the same `read`/`assert`/`item(...)` helpers you will find there). Do not create a DB connection.

**Step 2: Run it — must fail.**
Run: `node scripts/check-units.mjs`
Expected: FAIL on the new group (file does not exist yet).

**Step 3: Name the new check group and how it reports** exactly like the neighbors (summary count line `all N checks passed`). No other changes.

**Step 4: Commit** (the guard alone is fine to land red? no — we commit it with the migration in Task 5. Leave uncommitted.)

---

### Task 2: Migration `001500` — revoke + resend RPCs

**Files:**
- Create: `supabase/migrations/20260101001500_invite_cancel_and_resend.sql`

**Step 1: Write the migration.** Copy the header-comment voice of `001400`. Full body:

```sql
-- Owner dashboard actions for an invitation row: cancel (revoke -- the link
-- dies because `accept_invite_probe` refuses anything but `pending`) and
-- resend (a fresh raw token replaces the stored hash, so the old link is
-- dead the moment the new welcome email is mailed). Both are owner-only and
-- scoped to the caller's own organization, like every other invite write.

-- --------------------------------------------------------------- revoke

create or replace function smartgov.revoke_invite(
  p_session_token text,
  p_invite_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_status  smartgov.invite_status;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select i.status into v_status
    from smartgov.invites i
   where i.id = p_invite_id
     and i.organization_id = v_account.organization_id;

  if v_status is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_status = 'activated' then
    return jsonb_build_object('ok', false, 'reason', 'invite_activated');
  end if;

  if v_status <> 'revoked' then
    update smartgov.invites
       set status = 'revoked'
     where id = p_invite_id;
  end if;

  return jsonb_build_object('ok', true, 'inviteId', p_invite_id);
end;
$$;

revoke all on function smartgov.revoke_invite(text, uuid) from public;

-- --------------------------------------------------------------- resend

create or replace function smartgov.resend_invite(
  p_session_token text,
  p_invite_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_status  smartgov.invite_status;
  v_email   text;
  v_campus  text;
  v_org     text;
  v_raw     text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select i.status, i.email, i.campus_name into v_status, v_email, v_campus
    from smartgov.invites i
   where i.id = p_invite_id
     and i.organization_id = v_account.organization_id;

  if v_status is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_status = 'activated' then
    return jsonb_build_object('ok', false, 'reason', 'invite_activated');
  end if;

  if v_status = 'revoked' then
    return jsonb_build_object('ok', false, 'reason', 'invite_cancelled');
  end if;

  select o.name into v_org
    from public.organizations o
   where o.id = v_account.organization_id;

  update smartgov.invites
     set token_hash = smartgov.sha256(v_raw),
         status     = 'pending',
         expires_at = now() + interval '14 days'
   where id = p_invite_id;

  return jsonb_build_object(
    'ok', true,
    'token', v_raw,
    'inviteId', p_invite_id,
    'email', v_email,
    'campusName', v_campus,
    'organizationName', v_org,
    'universityName', v_account.university_name
  );
end;
$$;

revoke all on function smartgov.resend_invite(text, uuid) from public;

-- ------------------------------------------------------ PostgREST surface

create or replace function public.revoke_invite(
  p_session_token text,
  p_invite_id     uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.revoke_invite(p_session_token, p_invite_id);
$$;

revoke all on function public.revoke_invite(text, uuid) from public;
grant execute on function public.revoke_invite(text, uuid) to anon, authenticated;

create or replace function public.resend_invite(
  p_session_token text,
  p_invite_id     uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.resend_invite(p_session_token, p_invite_id);
$$;

revoke all on function public.resend_invite(text, uuid) from public;
grant execute on function public.resend_invite(text, uuid) to anon, authenticated;
```

**Step 2: Run the guard.** `node scripts/check-units.mjs` — the new item passes now.
**Step 3: Commit.**
```bash
git add supabase/migrations/20260101001500_invite_cancel_and_resend.sql scripts/check-units.mjs
git commit -m "feat: owner can revoke and resend invitations (dB RPCs, 001500)"
```

**Step 4: Apply to live DB** (yes — apply now; the RPCs must exist before you can behavior-test them). The migration file must be present in the worktree `supabase/migrations/` (it is — created here). Run:
```bash
supabase db push --db-url "postgresql://postgres.qyatedebfmupzntcltru:<DB_PASSWORD_URL_ENCODED>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres" --include-all
```
(it may need the same reconciliation trick as the units migration if another local migration is missing — confirm exactly `001500` is the final applied entry, and that `001300` is in the folder as it was previously copied there; do not alter it).

---

### Task 3: Behavior test — revoke + resend against live DB (rolled back)

**Files:**
- Create (temp, outside repo): `C:\Users\JULIUS~1.MAT\AppData\Local\Temp\opencode\invite-actions-behavior-test.mjs`
- Test: itself

Model it on `units-behavior-test.mjs` (same `pg` client, `begin`/`rollback`, `ok()` helper, synthetic org via `insert into public.organizations` + root `governance_units` + founding member + `smartgov.accounts` 'owner'). Scenarios:

1. **mint owner session** (`insert into smartgov.sessions` with hashed raw token — copy the helper).
2. **create a pending invite** via `select public.create_invite($1,'beh-actions-…@example.com','Beh Campus','lsg',$2,null)` for a brand-new synthetic unit's id → `ok:true`, capture `inviteId` + `token`.
3. **revoke**: `select public.revoke_invite($1,$inviteId)` → `ok:true`; then `select public.accept_invite_probe($oldToken)` → NOT `ok` (link dead), and `list_invites` no longer contains it.
4. **resend**: a second invite for a fresh email in the *same org* → `ok`; `select public.resend_invite($1,$inviteId2)` → `ok:true`, `token` differs from the original, and `accept_invite_probe($newToken)` returns `ok` while `accept_invite_probe($oldToken)` no longer does; invite row `status='pending'` and `expires_at` > original.
5. **guards**: non-owner (invited-scope account) → `forbidden`; an invite belonging to a *different* synthetic org → `not_found`; revoked invite resend → `invite_cancelled`; activated invite revoke → `invite_activated` (activate a row by setting `status='activated'` via SQL).
6. `rollback`, print `ALL BEHAVIOR CHECKS PASSED`/failures, exit code.

**Step: run it** — all PASS enabled the behavior; the RPCs are live. Commit nothing (temp file is outside the repo).

---

### Task 4: `messages.ts`

**Files:**
- Modify: `src/lib/auth/messages.ts` (inside `RPC_MESSAGES`, next to `no_unit`)

**Step 1:** add:
```ts
  invite_activated: "That invitation has already been activated.",
  invite_cancelled: "That invitation was cancelled.",
```
**Step 2:** `npx tsc --noEmit` clean. **Step 3:** commit with the routes (Task 5).

---

### Task 5: API routes — cancel + resend

**Files:**
- Create: `src/app/api/invites/cancel/route.ts`
- Create: `src/app/api/invites/resend/route.ts`

**Step 1 — cancel route** (mirror the guards of `invites/route.ts` POST; no mail):

```ts
import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IP_LIMIT = 60;
const IP_WINDOW_MS = 10 * 60_000;

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { inviteId?: string };
  try {
    body = ((await req.json()) ?? {}) as { inviteId?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const inviteId = typeof body.inviteId === "string" ? body.inviteId : "";
  if (!UUID_RE.test(inviteId)) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`invite:cancel:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const res = await callRpc<RpcResult>("revoke_invite", {
      p_session_token: token,
      p_invite_id: inviteId,
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[invites:cancel]", error);
    return NextResponse.json({ ok: false, message: "We could not cancel that invitation." }, { status: 500 });
  }
}
```

**Step 2 — resend route** (create route pattern + IP_LIMIT 20/10min + mail):

```ts
import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendBranded } from "@/lib/mail/send";
import { inviteEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IP_LIMIT = 20;
const IP_WINDOW_MS = 10 * 60_000;

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: { inviteId?: string };
  try {
    body = ((await req.json()) ?? {}) as { inviteId?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const inviteId = typeof body.inviteId === "string" ? body.inviteId : "";
  if (!UUID_RE.test(inviteId)) {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`invite:resend:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: messageFor("rate_limited") },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const res = await callRpc<RpcResult & {
      token?: string; email?: string; campusName?: string;
      organizationName?: string; universityName?: string;
    }>("resend_invite", { p_session_token: token, p_invite_id: inviteId });

    if (!res.ok) {
      return NextResponse.json({ ok: false, message: messageFor(res.reason) }, { status: 400 });
    }

    try {
      await sendBranded(
        inviteEmail({
          to: String(res.email),
          inviter: "Your student government",
          organizationName: String(res.organizationName ?? ""),
          universityName: String(res.universityName ?? ""),
          campusName: String(res.campusName ?? ""),
          token: String(res.token),
        }),
      );
    } catch (mailError) {
      console.error("[invites:resend]", mailError);
      return NextResponse.json({
        ok: false, delivered: false, code: "delivery_failed",
        email: String(res.email),
        message: "The invitation was refreshed but the email could not be sent. Ask them to check spam, then resend.",
      });
    }

    return NextResponse.json({ ok: true, delivered: true, email: String(res.email) });
  } catch (error) {
    console.error("[invites:resend]", error);
    return NextResponse.json({ ok: false, message: "We could not resend that invitation." }, { status: 500 });
  }
}
```

> Adjust `inviter` to match the create route's value (`inviter: account?.displayName ?? "Your student government"` needs `currentAccount()` — for parity, call `currentAccount()` like `invites/route.ts` does and use its displayName; add the import).

**Step 3:** add the two message keys (Task 4, committed together).
**Step 4:** `npm run lint`, `npx tsc --noEmit` both clean. **Step 5: commit.**
```bash
git add src/lib/auth/messages.ts src/app/api/invites/cancel/route.ts src/app/api/invites/resend/route.ts
git commit -m "feat: invite cancel and resend API routes"
```

---

### Task 6: Dashboard — Action column + Add {Type} label

**Files:**
- Modify: `src/components/dashboard/Workspace.tsx`

**Step 1 — state & helpers.** Add, next to the existing invite state:
```ts
const [busyId, setBusyId] = useState<string | null>(null);
const [confirmId, setConfirmId] = useState<string | null>(null);
const [note, setNote] = useState<string | null>(null);
```
Handlers (place with `onAddUnit`/`onInvite` in the component; `fetchInvites` already exists):

```ts
async function cancelInvitation(id: string) {
  setBusyId(id);
  setError(null);
  setNote(null);
  try {
    const res = await fetch("/api/invites/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId: id }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.message ?? "We could not cancel that invitation.");
      return;
    }
    setConfirmId(null);
    setInvites(await fetchInvites());
  } catch {
    setError("We could not reach the server. Check your connection and try again.");
  } finally {
    setBusyId(null);
  }
}

async function resendInvitation(id: string) {
  setBusyId(id);
  setError(null);
  setNote(null);
  try {
    const res = await fetch("/api/invites/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId: id }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.message ?? "We could not resend that invitation.");
      return;
    }
    setNote(`Invitation re-sent to ${data.email}. Check they received the new link.`);
  } catch {
    setError("We could not reach the server. Check your connection and try again.");
  } finally {
    setBusyId(null);
  }
}
```

**Step 2 — add-unit button label.** Replace the button's static label:
```tsx
{adding ? "Adding…" : `Add ${UNIT_TYPE_OPTIONS.find((t) => t.value === newUnitType)?.label ?? "campus"}`}
```

**Step 3 — table.** Change `<th>` list from `["Email","Campus or unit","Status","Invited","Activated"]` to `["Email","Campus or unit","Status","Invited","Action"]`. Remove the `<td>` that rendered `formatDate(invite.activatedAt)`. Add a final `<td>`:

```tsx
<td className="py-3 pl-4">
  {invite.status === "activated" ? (
    <span className="text-[0.8125rem] text-muted">—</span>
  ) : confirmId === invite.id ? (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void cancelInvitation(invite.id)}
        disabled={busyId !== null}
        className="rounded-full bg-ink px-3 py-1.5 text-[0.75rem] font-semibold text-canvas disabled:opacity-45"
      >
        Yes, cancel
      </button>
      <button
        type="button"
        onClick={() => setConfirmId(null)}
        disabled={busyId !== null}
        className="rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-muted disabled:opacity-45"
      >
        Keep
      </button>
      <p className="text-[0.6875rem] text-muted">The link will stop working immediately.</p>
    </div>
  ) : (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Resend invitation"
        title="Resend invitation"
        onClick={() => void resendInvitation(invite.id)}
        disabled={busyId !== null}
        className="rounded-full p-2 text-muted transition-colors hover:bg-paper hover:text-ink disabled:opacity-45"
      >
        <IconMail className="h-4 w-4" strokeWidth={1.9} />
      </button>
      <button
        type="button"
        aria-label="Cancel invitation"
        title="Cancel invitation"
        onClick={() => setConfirmId(confirmId === invite.id ? null : invite.id)}
        disabled={busyId !== null}
        className="rounded-full p-2 text-muted transition-colors hover:bg-paper hover:text-[#a5442c] disabled:opacity-45"
      >
        <IconClose className="h-4 w-4" strokeWidth={1.9} />
      </button>
    </div>
  )}
</td>
```

**Step 4 — success note.** Render `note` near the existing `sentTo` banner in the owner branch (same brass styling), clearing on next action (`setNote("")` in `onInvite`/`onAddUnit` starts and its error sibling; simplest: show under the table only when `note` non-null):
```tsx
{note ? (
  <p role="status" className="flex items-center gap-2 rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink">
    <IconCheck className="h-4 w-4 shrink-0 text-brass-deep" strokeWidth={2.2} />
    {note}
  </p>
) : null}
```

**Step 5:** ensure `IconMail` + `IconClose` imports from `@/components/ui/Icons` (IconCheck already there). Run `npm run lint`; `npx tsc --noEmit`; `node scripts/check-units.mjs` (87+1 now). **Step 6: commit.**
```bash
git add src/components/dashboard/Workspace.tsx
git commit -m "feat: dashboard invite action column with cancel and resend"
```

---

### Task 7: Full verification

Run in order and confirm each: `npm run lint` → `npx tsc --noEmit` → `node scripts/check-units.mjs` (≥88) → `node C:\Users\JULIUS~1.MAT\AppData\Local\Temp\opencode\invite-actions-behavior-test.mjs` (all PASS, rolled back) → `npm run build` (route list must include `/api/invites/cancel` and `/api/invites/resend`). Report each result.

---

### Task 8: Deploy + live E2E + cleanup

**Step 1 — deploy fast path:** `git push https://x-access-token:<GITHUB_PAT>@github.com/dreamerdev-SYS/smartgov.git feature/invite-actions:feature/invite-actions` (projectId and teamId live in the conversation summary; `<VERCEL_TOKEN>` for the deployments poll and `vercel promote <preview-url> --token <token> --yes`), then `vercel promote <preview-url> --token <token> --yes`. Confirm `https://sgov.vercel.app/api/invites/cancel` (POST) returns 401 when anonymous.

**Step 2 — live API E2E** (extend `units-prod-e2e.mjs` in the temp dir, same minted-owner-session technique; cleanup in `finally`):
- mint owner session → `POST /api/invites` (unitId of a throwaway unit) → capture `inviteId` by reading `/api/invites` — or simpler, `POST /api/invites/resend {inviteId}` where inviteId comes from the list row for the throwaway email.
- `POST /api/invites/resend {inviteId}` → `{ ok:true, delivered:true }`; the row's link changed (old raw token no longer probes; new one does — probe via `public.accept_invite_probe` in SQL).
- `POST /api/invites/cancel {inviteId}` → `{ ok:true }`; the email leaves `/api/invites` list; `list_invites` SQL shows status `revoked`.
- guards: cancel with random-other-uuid → 400 `not_found`; malformed id → 400.
- delete the throwaway unit + invite + roster + memberships + session (same cleanup SQL as `units-prod-e2e.mjs`).

**Step 3 — merge:** report to the user, then `finishing-a-development-branch` (merge local into `main` with `--no-ff`, delete branch + worktree; do NOT push `main` unless the user asks — the OTP work is still uncommitted in the main workspace).

---

## Commits to expect

1. `feat: owner can revoke and resend invitations (dB RPCs, 001500)`
2. `feat: invite cancel and resend API routes`
3. `feat: dashboard invite action column with cancel and resend`
(design doc already committed as `d6b489c`.)