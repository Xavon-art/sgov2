import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";

const failures: string[] = [];

function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures.push(name);
}

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

function staticChecks() {
  const rpcSql = read("supabase/migrations/20260101005010_budget_rpcs.sql");
  const compatSql = read("supabase/migrations/20260101005020_budget_compat.sql");
  const budgets = read("src/app/api/budgets/route.ts");
  const eventBudget = read("src/app/api/events/[id]/budget/route.ts");
  const unitExpenses = read("src/app/api/budgets/unit-expenses/route.ts");
  const unitOverview = read("src/app/api/budgets/unit-overview/route.ts");
  const review = read("src/app/api/budgets/[id]/review/route.ts");
  const detail = read("src/app/api/budgets/[id]/route.ts");
  const isolationSql = read("supabase/migrations/20260101005110_phase10_data_isolation.sql");
  const taskRpcSql = read("supabase/migrations/20260101004850_deadline_duration_system.sql");
  const documentSql = read("supabase/migrations/20260101003480_unified_submission_catalog.sql");
  const taskDetailApi = read("src/app/api/tasks/[taskId]/route.ts");
  const taskAnswersApi = read("src/app/api/tasks/answers/route.ts");
  const documentsApi = read("src/app/api/documents/route.ts");
  const filesApi = read("src/app/api/files/[submissionId]/route.ts");

  check("phase10 rollup wrapper renames the legacy function", isolationSql.includes("rename to budget_parent_rollup_legacy"));
  check("phase10 rollup wrapper denies LSG descendants", isolationSql.includes("v_allowed_units := '{}'::uuid[]"));
  check("phase10 rollup wrapper re-exposes the public RPC", isolationSql.includes("create or replace function public.budget_parent_rollup"));
  check("task detail RPC checks caller units", taskRpcSql.includes("smartgov.lsg_unit_ids(v_account.id, v_account.organization_id)"));
  check("document catalog scopes non-approved rows to caller units", documentSql.includes("v_row.origin_unit_id = any (v_units)"));
  check("document catalog records approved org-wide rows", documentSql.includes("as visible_to_org"));

  check("unit overview RPC checks lsg_unit_ids", rpcSql.includes("smartgov.lsg_unit_ids(v_account.id, v_account.organization_id)"));
  check("submit RPC checks lsg_unit_ids", rpcSql.includes("submit_unit_budget_request"));
  check("record RPC checks lsg_unit_ids", rpcSql.includes("record_unit_budget_expense"));
  check("compat budget detail checks lsg_unit_ids", compatSql.includes("budget_detail"));
  check("compat spending checks lsg_unit_ids", compatSql.includes("set_budget_actual_spent"));

  check("budget create API uses unit RPC", budgets.includes('"submit_unit_budget_request"'));
  check("budget create API derives unit on server", budgets.includes("p_unit_id: null"));
  check("budget create API does not accept body unitId", !/unitId\?: unknown/.test(budgets));
  check("event budget API derives unit on server", eventBudget.includes("p_unit_id: null") && eventBudget.includes("p_event_id: eventId"));
  check("unit expense API derives unit from request", unitExpenses.includes('"record_budget_expense_by_request"'));
  check("unit overview API requires session token", unitOverview.includes("readSessionToken()"));
  check("review API requires session token", review.includes("readSessionToken()"));
  check("spending API uses per-unit ledger RPC", detail.includes('"record_budget_spend_total"'));
  check("task detail API requires session token", taskDetailApi.includes("readSessionToken()"));
  check("task answer API requires session token", taskAnswersApi.includes("readSessionToken()"));
  check("document API requires session token", documentsApi.includes("readSessionToken()"));
  check("document download API requires session token", filesApi.includes("readSessionToken()"));
}

type RpcResponse = { ok?: boolean; reason?: string; [key: string]: unknown };
type SearchRow = { submissionId?: string };

async function call(client: PoolClient, name: string, args: unknown[]): Promise<RpcResponse> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(", ");
  const result = await client.query<{ result: RpcResponse }>(
    `select public."${name}"(${placeholders}) as result`,
    args,
  );
  return result.rows[0]?.result ?? {};
}

async function dynamicChecks() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    console.log("SKIP  dynamic budget isolation probe (DATABASE_URL is not configured)");
    return;
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const orgId = randomUUID();
  const unitA = randomUUID();
  const childUnit = randomUUID();
  const unitB = randomUUID();
  const accountA = randomUUID();
  const accountB = randomUUID();
  const budgetB = randomUUID();
  const childBudget = randomUUID();
  const taskB = randomUUID();
  const docSubmission = randomUUID();
  const period = randomUUID();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const tokenA = `isolation-a-${suffix}`;
  const tokenB = `isolation-b-${suffix}`;
  const items = JSON.stringify([{ label: "Paper", quantity: 1, unit_cost: "101.00" }]);

  try {
    await client.query("begin");
    await client.query(
      `insert into public.organizations
         (id, slug, name, governance_model, charter_number, academic_year, university_name)
       values ($1, $2, $3, 'federated', $4, '2026-2027', 'Isolation University')`,
      [orgId, `budget-isolation-${suffix}`, `Budget Isolation ${suffix}`, `CHARTER-${suffix}`],
    );
    await client.query(
      `insert into public.governance_units (id, organization_id, name, unit_type, parent_id)
       values ($1, $2, 'Unit A', 'lsg', null),
              ($3, $2, 'Unit A child', 'lsg', $1),
              ($4, $2, 'Unit B', 'lsg', null)`,
      [unitA, orgId, childUnit, unitB],
    );
    await client.query(
      `insert into smartgov.accounts
         (id, email, password_hash, display_name, account_kind, account_scope, organization_id,
          university_name, status, unit_id, is_unit_account)
       values
         ($1, $2, $7, 'Unit A Officer', 'lsg', 'invited', $5, 'Isolation University', 'active', $3, true),
         ($4, $6, $7, 'Unit B Officer', 'lsg', 'invited', $5, 'Isolation University', 'active', $8, true)`,
      [accountA, `a-${suffix}@example.test`, unitA, accountB, orgId, `b-${suffix}@example.test`, "x".repeat(60), unitB],
    );
    await client.query(
      `insert into smartgov.sessions (account_id, token_hash, expires_at)
       values ($1, smartgov.sha256($2), now() + interval '1 hour'),
              ($3, smartgov.sha256($4), now() + interval '1 hour')`,
      [accountA, tokenA, accountB, tokenB],
    );
    await client.query(
      `insert into smartgov.budget_periods (id, organization_id, label, starts_on, ends_on, status)
       values ($1, $2, 'Isolation period', current_date, current_date + 30, 'open')`,
      [period, orgId],
    );
    await client.query(
      `insert into smartgov.budget_allocations (period_id, unit_id, allocated_amount, note)
       values ($1, $2, 100, 'isolation probe'),
              ($1, $3, 25, 'isolation probe'),
              ($1, $4, 50, 'isolation probe')`,
      [period, unitA, childUnit, unitB],
    );
    await client.query(
      `insert into smartgov.budget_requests
         (id, organization_id, unit_id, period_id, requested_by, title, status,
          requested_total, approved_total, actual_spent)
       values ($1, $2, $3, $4, $5, 'Unit B approved budget', 'approved', 50, 50, 0),
              ($6, $2, $7, $4, $5, 'Unit A child approved budget', 'approved', 25, 25, 0)`,
      [budgetB, orgId, unitB, period, accountB, childBudget, childUnit],
    );
    await client.query(
      `insert into smartgov.tasks (id, organization_id, title, created_by)
       values ($1, $2, 'Unit B isolation task', $3)`,
      [taskB, orgId, accountB],
    );
    await client.query(
      `insert into smartgov.task_assignments (task_id, unit_id)
       values ($1, $2)`,
      [taskB, unitB],
    );
    const docRequirement = await client.query(
      `insert into smartgov.requirement_items (organization_id, label, item_kind)
       values ($1, 'Isolation document requirement', 'file') returning id`,
      [orgId],
    );
    const docProposal = await client.query(
      `insert into smartgov.proposals
         (organization_id, unit_id, author_kind, created_by, title, description)
       values ($1, $2, 'lsg', $3, 'Isolation document proposal', 'Isolation fixture') returning id`,
      [orgId, unitB, accountB],
    );
    const docVersion = await client.query(
      `insert into smartgov.proposal_versions (proposal_id, version_number, submitted_by)
       values ($1, 1, $2) returning id`,
      [docProposal.rows[0].id, accountB],
    );
    const docOid = await client.query(
      `select lo_from_bytea(0, convert_to('isolation document bytes', 'UTF8')) as oid`,
    );
    const docStoragePath = `isolation-doc-${suffix}.txt`;
    await client.query(
      `insert into smartgov.document_uploads
         (storage_path, organization_id, uploaded_by, requirement_item,
          original_name, mime_type, size_bytes, large_object_oid, confirmed_at)
       values ($1, $2, $3, $4, 'isolation-doc.txt', 'text/plain', 24, $5, now())`,
      [docStoragePath, orgId, accountB, docRequirement.rows[0].id, docOid.rows[0].oid],
    );
    await client.query(
      `insert into smartgov.item_submissions
         (id, version_id, requirement_item_id, submission_kind, storage_path,
          original_name, mime_type, size_bytes)
       values ($1, $2, $3, 'file', $4, 'isolation-doc.txt', 'text/plain', 24)`,
      [docSubmission, docVersion.rows[0].id, docRequirement.rows[0].id, docStoragePath],
    );

    const ownOverview = await call(client, "get_unit_budget_overview", [tokenA, unitA, null]);
    check("Unit A can read its own overview", ownOverview.ok === true);

    const ownRollup = await call(client, "budget_parent_rollup", [tokenA, unitA, null]);
    check(
      "Unit A own rollup does not expose descendant budgets",
      ownRollup.ok === true &&
        Array.isArray(ownRollup.children) &&
        ownRollup.children.length === 0,
    );

    const childOwnRollup = await call(client, "budget_parent_rollup", [tokenA, childUnit, null]);
    check(
      "Unit A cannot roll up its child unit",
      childOwnRollup.ok === false && childOwnRollup.reason === "forbidden",
    );

    const cases: Array<[string, string, unknown[]]> = [
      ["Unit A cannot read Unit B overview", "get_unit_budget_overview", [tokenA, unitB, null]],
      ["Unit A cannot read Unit B expenses", "list_unit_budget_expenses", [tokenA, unitB, null]],
      ["Unit A cannot read Unit B requests", "list_unit_budget_requests", [tokenA, unitB, null]],
      ["Unit A cannot submit for Unit B", "submit_unit_budget_request", [tokenA, unitB, null, "Unauthorized request", "x", items, null, null]],
      ["Unit A cannot record Unit B expense", "record_unit_budget_expense", [tokenA, unitB, budgetB, 1, "x", null]],
      ["Unit A cannot record by Unit B request", "record_budget_expense_by_request", [tokenA, budgetB, 1, "x", null]],
      ["Unit A cannot roll up Unit B", "budget_parent_rollup", [tokenA, unitB, null]],
      ["Unit A cannot detail Unit B request", "budget_detail", [tokenA, budgetB]],
      ["Unit A cannot detail Unit B task", "task_detail", [tokenA, taskB]],
      ["Unit A cannot spend on Unit B request", "record_budget_spend_total", [tokenA, budgetB, 1, "x", null]],
      ["Unit A cannot review Unit B request", "review_budget", [tokenA, budgetB, "approved", 1, "x"]],
    ];

    for (const [name, rpc, args] of cases) {
      const res = await call(client, rpc, args);
      check(name, res.ok === false && res.reason === "forbidden");
    }

    const pendingSearch = await call(client, "search_documents", [tokenA, "Isolation document", null, null, 50, null, null, unitB]);
    check(
      "Unit A cannot find Unit B pending document",
      pendingSearch.ok === true &&
        !((pendingSearch.rows as SearchRow[] | undefined) ?? []).some((row) => row.submissionId === docSubmission),
    );
    const pendingDownload = await call(client, "get_document", [tokenA, docSubmission]);
    check("Unit A cannot download Unit B pending document", pendingDownload.ok === false);

    await client.query(
      `update smartgov.document_catalog
          set approval_status = 'approved', approved_by = $3, approved_at = now()
        where submission_id = $1 and organization_id = $2`,
      [docSubmission, orgId, accountB],
    );
    const approvedSearch = await call(client, "search_documents", [tokenA, "Isolation document", null, "approved", 50, null, null, unitB]);
    check(
      "approved document is org-wide by design",
      approvedSearch.ok === true &&
        ((approvedSearch.rows as SearchRow[] | undefined) ?? []).some((row) => row.submissionId === docSubmission),
    );
    const approvedDownload = await call(client, "get_document", [tokenA, docSubmission]);
    check("approved document is org-wide downloadable by design", approvedDownload.ok === true);

    const overAllocation = await call(client, "submit_unit_budget_request", [
      tokenA,
      unitA,
      null,
      "Over allocation request",
      "x",
      items,
      null,
      null,
    ]);
    check("Unit A cannot request beyond its allocation", overAllocation.ok === false && overAllocation.reason === "allocation_exceeded");
  } finally {
    await client.query("rollback");
    client.release();
    await pool.end();
  }
}

async function main() {
  staticChecks();
  await dynamicChecks();
  if (failures.length) {
    console.error(`\n${failures.length} budget isolation check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("\nBudget isolation checks passed.");
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
