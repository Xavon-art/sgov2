// Applies one or more SQL migration files to the remote Postgres over the
// pooled connection string in .env.local.
//
// Why this exists: `supabase db push` needs `supabase link`, and link needs a
// Management API privilege this machine's token does not have. There is no
// `psql` here either. The project already depends on `pg`, so applying a file
// directly is the shortest honest path that does not embed a credential.
//
//   node scripts/apply-migration.mjs supabase/migrations/<file>.sql
//
// Idempotent by file: it records applied names in a small ledger table, so
// re-running a file that is already recorded is a no-op.

import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import pg from "pg";

function loadEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...loadEnv(".env"), ...loadEnv(".env.local") };
const url = env.POSTGRES_URL || env.DATABASE_URL;

if (!url) {
  console.error("No POSTGRES_URL or DATABASE_URL in .env.local");
  process.exit(1);
}

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
// `--force` re-applies a file that is already recorded. Needed when a migration
// is still being edited in the same slice and has already gone out once.
const force = process.argv.includes("--force");

if (files.length === 0) {
  console.error("Usage: node scripts/apply-migration.mjs [--force] <file.sql> [more.sql ...]");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

try {
  await client.connect();

  await client.query(`
    create table if not exists smartgov.applied_migrations (
      name        text primary key,
      applied_at  timestamptz not null default now()
    );
  `);

  for (const file of files) {
    const name = basename(file);

    const seen = await client.query(
      "select 1 from smartgov.applied_migrations where name = $1",
      [name],
    );

    if (seen.rowCount > 0 && !force) {
      console.log(`skip    ${name} (already applied)`);
      continue;
    }

    const sql = readFileSync(resolve(file), "utf8");

    // One transaction per file so a failure leaves no partial state.
    await client.query("begin");
    try {
      await client.query(sql);
      // Upsert, not insert: a `--force` re-run has to refresh the timestamp
      // rather than trip the primary key.
      await client.query(
        `insert into smartgov.applied_migrations (name) values ($1)
         on conflict (name) do update set applied_at = now()`,
        [name],
      );
      await client.query("commit");
      console.log(`applied ${name}`);
    } catch (error) {
      await client.query("rollback");
      console.error(`FAILED  ${name}`);
      console.error(error.message);
      process.exit(1);
    }

    // PostgREST answers /rpc from a cache of the schema it built at start. A
    // migration that adds or changes a public function is invisible to the app
    // until that cache is rebuilt, and the app then fails with "Could not find the
    // function ... in the schema cache" for a function that plainly exists. Ask it
    // to reload. This sits outside the transaction on purpose: it is a notice to
    // another process, not part of the migration, and it must not be rolled back
    // with it.
    try {
      await client.query("notify pgrst, 'reload schema'");
      console.log(`         reloaded the PostgREST schema cache`);
    } catch (error) {
      // Supabase's channel can be renamed on a self-hosted instance. A stale cache
      // is an annoyance to clear by hand, not a reason to report a good migration
      // as failed.
      console.warn(`         could not reload the PostgREST schema cache: ${error.message}`);
    }
  }
} finally {
  await client.end();
}