import { readFileSync } from "node:fs";
import pg from "pg";

const args = process.argv.slice(2);

function usage() {
  console.log("Usage: node scripts/audit-connections.mjs [--json] [--verbose] [--help]");
  console.log("Read-only SmartGov1 connection, ACL, and integrity audit.");
  console.log("Flags:");
  console.log("  --json     emit one deterministic JSON report");
  console.log("  --verbose  include itemized catalog findings in table output");
  console.log("  --help     show this help");
}

if (args.includes("--help")) {
  usage();
  process.exit(0);
}

const allowedFlags = new Set(["--json", "--verbose"]);
const unknownFlags = args.filter((arg) => !allowedFlags.has(arg));
if (unknownFlags.length > 0) {
  console.error(`Unknown flag(s): ${unknownFlags.join(", ")}`);
  usage();
  process.exit(2);
}

const jsonMode = args.includes("--json");
const verboseMode = args.includes("--verbose");

function loadEnv(source) {
  const values = {};
  let text;
  try {
    text = readFileSync(source, "utf8");
  } catch {
    return values;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const env = loadEnv(new URL("../.env.local", import.meta.url));
const rawUrl = process.env.DATABASE_URL || env.DATABASE_URL;
if (!rawUrl) {
  console.error("DATABASE_URL is not set in .env.local or the environment");
  process.exit(2);
}

function withParam(url, key, value) {
  if (new RegExp(`[?&]${key}=`, "i").test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${value}`;
}

const connectionString = withParam(withParam(rawUrl, "sslmode", "require"), "uselibpqcompat", "true");

function redact(value) {
  let text = String(value);
  text = text.split(rawUrl).join("[redacted]");
  text = text.split(connectionString).join("[redacted]");
  text = text.replace(/[a-z][a-z\d+.-]*:\/\/[^\s'"`,;]+/gi, "[redacted-url]");
  text = text.replace(/((?:password|pwd|secret|token)\s*=\s*)[^\s&'"`,;]+/gi, "$1[redacted]");
  return text;
}

function qi(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

const Q_FKS = `
SELECT con.oid::text AS oid,
       n.nspname AS sch,
       cl.relname AS tbl,
       con.conname AS name,
       (SELECT string_agg(a.attname, ',' ORDER BY u.ord)
          FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum) AS cols,
       rn.nspname AS ref_sch,
       rc.relname AS ref_tbl,
       (SELECT string_agg(a.attname, ',' ORDER BY u.ord)
          FROM unnest(con.confkey) WITH ORDINALITY AS u(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = u.attnum) AS ref_cols
FROM pg_constraint AS con
JOIN pg_class AS cl ON cl.oid = con.conrelid
JOIN pg_namespace AS n ON n.oid = cl.relnamespace
JOIN pg_class AS rc ON rc.oid = con.confrelid
JOIN pg_namespace AS rn ON rn.oid = rc.relnamespace
WHERE con.contype = 'f'
  AND n.nspname IN ('smartgov', 'public')
  AND cl.relkind IN ('r', 'p')
  AND rc.relkind IN ('r', 'p')
ORDER BY 2, 3, 4
`;

const Q_MISSING_FKS = `
SELECT n.nspname AS sch,
       cl.relname AS tbl,
       a.attname AS col,
       format_type(a.atttypid, a.atttypmod) AS typ
FROM pg_attribute AS a
JOIN pg_class AS cl ON cl.oid = a.attrelid
JOIN pg_namespace AS n ON n.oid = cl.relnamespace
WHERE n.nspname IN ('smartgov', 'public')
  AND cl.relkind IN ('r', 'p')
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND (right(a.attname, 3) = '_id' OR a.attname IN ('target_id', 'created_by', 'updated_by', 'deactivation_scheduled_by'))
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint AS con
    WHERE con.conrelid = cl.oid AND con.contype = 'f' AND a.attnum = ANY (con.conkey)
  )
ORDER BY 1, 2, 3
`;

const Q_RLS_NO_POLICY = `
SELECT n.nspname AS sch, cl.relname AS tbl
FROM pg_class AS cl
JOIN pg_namespace AS n ON n.oid = cl.relnamespace
WHERE n.nspname IN ('smartgov', 'public')
  AND cl.relkind IN ('r', 'p')
  AND cl.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policy AS p WHERE p.polrelid = cl.oid)
ORDER BY 1, 2
`;

const Q_DIRECT_GRANTS = `
SELECT n.nspname AS sch,
       cl.relname AS tbl,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type
FROM pg_class AS cl
JOIN pg_namespace AS n ON n.oid = cl.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(cl.relacl, acldefault('r', cl.relowner))) AS a
WHERE n.nspname IN ('smartgov', 'public')
  AND cl.relkind IN ('r', 'p')
  AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
ORDER BY 1, 2, 3, 4
`;

const Q_DEFINER_NO_SEARCH_PATH = `
SELECT n.nspname AS sch,
       p.proname AS fn,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname IN ('smartgov', 'public')
  AND p.prosecdef
  AND NOT EXISTS (
    SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}'::text[])) AS c WHERE c LIKE 'search_path=%'
  )
ORDER BY 1, 2, 3
`;

const Q_PUBLIC_DEFINER = `
SELECT n.nspname AS sch,
       p.proname AS fn,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  )
ORDER BY 1, 2, 3
`;

const Q_TOKEN_WRAPPERS = `
SELECT p.proname AS fn,
       pg_get_function_identity_arguments(p.oid) AS args,
       CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS sec,
       pg_get_functiondef(p.oid) AS def
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND pg_get_function_identity_arguments(p.oid) LIKE '%p_session_token%'
ORDER BY 1, 2
`;

function functionBody(definition) {
  const tagged = definition.match(/AS\s+\$([A-Za-z_][A-Za-z0-9_]*)\$([\s\S]*)\$\1\$/i);
  if (tagged) return tagged[2];
  const plain = definition.match(/AS\s+\$\$([\s\S]*)\$\$/i);
  return plain ? plain[1] : definition;
}

const Q_STATUS_NO_CHECK = `
SELECT n.nspname AS sch,
       cl.relname AS tbl,
       a.attname AS col,
       format_type(a.atttypid, a.atttypmod) AS typ,
       (t.typtype = 'e') AS enum_typed
FROM pg_attribute AS a
JOIN pg_class AS cl ON cl.oid = a.attrelid
JOIN pg_namespace AS n ON n.oid = cl.relnamespace
JOIN pg_type AS t ON t.oid = a.atttypid
WHERE n.nspname IN ('smartgov', 'public')
  AND cl.relkind IN ('r', 'p')
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND a.attname ~* 'status|state'
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint AS con
    WHERE con.conrelid = cl.oid AND con.contype = 'c' AND a.attnum = ANY (con.conkey)
  )
ORDER BY 1, 2, 3
`;

const Q_FKS_NO_INDEX = `
WITH fkc AS (
  SELECT con.oid,
         con.conrelid,
         con.conname,
         array_agg(a.attname ORDER BY u.ord) AS cols,
         count(*)::int AS ncols
  FROM pg_constraint AS con
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
  JOIN pg_attribute AS a ON a.attrelid = con.conrelid AND a.attnum = u.attnum
  WHERE con.contype = 'f'
    AND con.connamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('smartgov', 'public'))
  GROUP BY con.oid, con.conrelid, con.conname
), idx AS (
  SELECT i.indrelid,
         array_agg(a.attname ORDER BY u.ord) AS cols
  FROM pg_index AS i
  CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS u(attnum, ord)
  JOIN pg_attribute AS a ON a.attrelid = i.indrelid AND a.attnum = u.attnum
  GROUP BY i.indrelid, i.indexrelid
)
SELECT n.nspname AS sch,
       cl.relname AS tbl,
       f.conname AS fk_name,
       f.cols AS fk_cols
FROM fkc AS f
JOIN pg_class AS cl ON cl.oid = f.conrelid
JOIN pg_namespace AS n ON n.oid = cl.relnamespace
WHERE NOT EXISTS (
  SELECT 1 FROM idx WHERE idx.indrelid = f.conrelid AND idx.cols[1:f.ncols] = f.cols
)
ORDER BY 1, 2, 3
`;

const Q_OTP_RISK = `
SELECT n.nspname AS sch,
       p.proname AS fn,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname IN ('smartgov', 'public')
  AND p.proname IN ('create_survey_otp', 'verify_survey_otp')
ORDER BY 1, 2
`;

const Q_ENUMS = `
SELECT n.nspname AS sch,
       t.typname AS typ,
       string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS values_csv
FROM pg_type AS t
JOIN pg_enum AS e ON e.enumtypid = t.oid
JOIN pg_namespace AS n ON n.oid = t.typnamespace
WHERE n.nspname IN ('smartgov', 'public', 'extensions')
GROUP BY 1, 2
ORDER BY 1, 2
`;

const Q_STATUS_CHECKS = `
SELECT n.nspname AS sch,
       cl.relname AS tbl,
       con.conname,
       pg_get_constraintdef(con.oid) AS def
FROM pg_constraint AS con
JOIN pg_class AS cl ON cl.oid = con.conrelid
JOIN pg_namespace AS n ON n.oid = cl.relnamespace
WHERE con.contype = 'c'
  AND n.nspname IN ('smartgov', 'public')
  AND (con.conname ~* 'status|state|mode' OR pg_get_constraintdef(con.oid) ~* 'status|state|mode')
ORDER BY 1, 2, 3
`;

function orphanQuery(fk) {
  const cols = fk.cols.split(",");
  const refCols = fk.ref_cols.split(",");
  const src = `${qi(fk.sch)}.${qi(fk.tbl)}`;
  const ref = `${qi(fk.ref_sch)}.${qi(fk.ref_tbl)}`;
  const join = cols.map((col, index) => `c.${qi(col)} = p.${qi(refCols[index])}`).join(" AND ");
  const notNull = cols.map((col) => `c.${qi(col)} IS NOT NULL`).join(" AND ");
  const projections = cols.map((col) => `c.${qi(col)}`).join(", ");
  const keys = cols.map((col) => `to_jsonb(c.${qi(col)})`).join(", ");
  const order = cols.map((col) => `c.${qi(col)}`).join(", ");
  return `
WITH orphan AS (
  SELECT ${projections}
  FROM ${src} AS c
  LEFT JOIN ${ref} AS p ON ${join}
  WHERE (${notNull}) AND p.${qi(refCols[0])} IS NULL
), counted AS (
  SELECT count(*)::bigint AS n FROM orphan
)
SELECT (SELECT n::text FROM counted) AS n,
       (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb)
           FROM (SELECT jsonb_build_array(${keys}) AS k FROM orphan AS c ORDER BY ${order} LIMIT 5) AS s) AS samples
`;
}

const pool = new pg.Pool({
  connectionString,
  max: 1,
  application_name: "smartgov_connections_audit",
  connectionTimeoutMillis: 5000,
  query_timeout: 15000,
  statement_timeout: 8000,
});

async function runAudit() {
  const client = await pool.connect();
  const report = {};
  const q = async (label, sql) => {
    try {
      return await client.query(sql);
    } catch (error) {
      error.auditQuery = label;
      throw error;
    }
  };
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8000'");

    const fks = (await q("foreign_keys", Q_FKS)).rows;
    report.foreignKeyCount = fks.length;
    const orphanFkRows = [];
    for (const fk of fks) {
      const result = (await q(`orphan:${fk.sch}.${fk.tbl}.${fk.name}`, orphanQuery(fk))).rows[0] || {};
      const count = Number(result.n || 0);
      if (count > 0) {
        orphanFkRows.push({
          schema: fk.sch,
          table: fk.tbl,
          constraint: fk.name,
          count,
          sampleKeys: result.samples || [],
        });
      }
    }
    report.orphanFkRows = orphanFkRows;
    report.missingFkCandidates = (await q("missing_fk_candidates", Q_MISSING_FKS)).rows;
    report.rlsTablesWithoutPolicies = (await q("rls_without_policies", Q_RLS_NO_POLICY)).rows;
    report.directUntrustedGrants = (await q("direct_untrusted_grants", Q_DIRECT_GRANTS)).rows;
    report.definerFunctionsWithoutSearchPath = (await q("definer_without_search_path", Q_DEFINER_NO_SEARCH_PATH)).rows;
    report.publicDefinerFunctions = (await q("public_definer_execute", Q_PUBLIC_DEFINER)).rows;
    const tokenRows = (await q("token_ignoring_wrappers", Q_TOKEN_WRAPPERS)).rows;
    report.tokenIgnoringWrappers = tokenRows
      .filter((row) => {
        const body = functionBody(row.def);
        return !body.includes("p_session_token") && !body.includes("$1");
      })
      .map(({ fn, args, sec }) => ({ sch: "public", fn, args, sec }));

    report.statusColumnsWithoutCheck = (await q("status_without_check", Q_STATUS_NO_CHECK)).rows;
    report.foreignKeysWithoutLeadingIndex = (await q("fks_without_index", Q_FKS_NO_INDEX)).rows;
    const otpRows = (await q("otp_risk", Q_OTP_RISK)).rows;
    const createOtp = otpRows.find((row) => row.fn === "create_survey_otp");
    const verifyOtp = otpRows.find((row) => row.fn === "verify_survey_otp");
    const pattern =
      Boolean(createOtp && /p_code_hash/.test(createOtp.args) && /p_ttl_minutes/.test(createOtp.args)) ||
      Boolean(verifyOtp && /p_code_hash/.test(verifyOtp.args) && createOtp && /p_ttl_minutes/.test(createOtp.args));
    report.otpCallerControlledPattern = pattern;
    report.otpFunctionEvidence = otpRows;
    report.enumValues = (await q("enum_values", Q_ENUMS)).rows;
    report.statusCheckConstraints = (await q("status_checks", Q_STATUS_CHECKS)).rows;

    report.critical = [];
    if (report.orphanFkRows.length > 0) report.critical.push("orphan_fk_rows");
    if (report.directUntrustedGrants.length > 0) report.critical.push("direct_untrusted_table_grants");
    if (report.tokenIgnoringWrappers.length > 0) report.critical.push("token_ignoring_wrapper");
    if (pattern) report.critical.push("caller_controlled_otp_hash_ttl");
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      void 0;
    }
    throw error;
  } finally {
    client.release();
  }
  return report;
}

function printTable(report) {
  const rows = [
    ["foreign_keys", report.foreignKeyCount],
    ["orphan_fk_rows", report.orphanFkRows.length],
    ["missing_fk_candidates", report.missingFkCandidates.length],
    ["rls_tables_without_policies", report.rlsTablesWithoutPolicies.length],
    ["direct_untrusted_table_grants", report.directUntrustedGrants.length],
    ["definer_without_search_path", report.definerFunctionsWithoutSearchPath.length],
    ["public_definer_execute", report.publicDefinerFunctions.length],
    ["token_ignoring_wrappers", report.tokenIgnoringWrappers.length],
    ["status_columns_without_check", report.statusColumnsWithoutCheck.length],
    ["fks_without_leading_index", report.foreignKeysWithoutLeadingIndex.length],
    ["otp_caller_controlled_pattern", report.otpCallerControlledPattern ? "yes" : "no"],
    ["allowed_enum_types", report.enumValues.length],
    ["status_check_constraints", report.statusCheckConstraints.length],
  ];
  console.log("audit-connections read-only audit");
  for (const [label, value] of rows) {
    console.log(`${label.padEnd(32)} ${value}`);
  }
  if (verboseMode) {
    for (const [label, value] of Object.entries({
      orphan_fk_rows: report.orphanFkRows,
      missing_fk_candidates: report.missingFkCandidates,
      rls_tables_without_policies: report.rlsTablesWithoutPolicies,
      direct_untrusted_table_grants: report.directUntrustedGrants,
      definer_without_search_path: report.definerFunctionsWithoutSearchPath,
      public_definer_execute: report.publicDefinerFunctions,
      token_ignoring_wrappers: report.tokenIgnoringWrappers,
      status_columns_without_check: report.statusColumnsWithoutCheck,
      fks_without_leading_index: report.foreignKeysWithoutLeadingIndex,
      otp_function_evidence: report.otpFunctionEvidence,
      allowed_enum_values: report.enumValues,
      status_check_constraints: report.statusCheckConstraints,
    })) {
      console.log(`${label}: ${JSON.stringify(value)}`);
    }
  }
  console.log(`critical: ${report.critical.length > 0 ? report.critical.join(",") : "none"}`);
  console.log(`result: ${report.critical.length > 0 ? "FAIL" : "PASS"}`);
}

async function main() {
  try {
    const report = await runAudit();
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printTable(report);
    }
    return report.critical.length > 0 ? 1 : 0;
  } catch (error) {
    const message = error && error.message ? error.message : error;
    const detail = error && error.position ? ` (position ${error.position})` : "";
    const label = error && error.auditQuery ? ` [${error.auditQuery}]` : "";
    console.error(`audit failed${label}: ${redact(message)}${detail}`);
    return 2;
  } finally {
    await pool.end();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`audit failed: ${redact(error && error.message ? error.message : error)}`);
    process.exitCode = 2;
  });
