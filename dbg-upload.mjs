import { readFileSync } from "node:fs";
import pg from "pg";
const o = {};
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  o[m[1]] = v;
}
const c = new pg.Client({ connectionString: o.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const fns = await c.query(`select p.proname, pg_get_function_identity_arguments(p.oid) args
  from pg_proc p where p.pronamespace='smartgov'::regnamespace
    and (p.proname like '%document%' or p.proname like '%upload%' or p.proname like '%chunk%')
  order by p.proname`);
console.log("=== document/upload functions ===");
for (const r of fns.rows) console.log(`  smartgov.${r.proname}(${r.args})`);

console.log("\n=== document_uploads columns ===");
const cols = await c.query(`select column_name, data_type, is_nullable from information_schema.columns where table_schema='smartgov' and table_name='document_uploads' order by ordinal_position`);
for (const r of cols.rows) console.log(`  ${r.column_name} ${r.data_type} ${r.is_nullable==='YES'?'NULL':'NOT NULL'}`);

console.log("\n=== claim_document_upload source (first 90 lines) ===");
const src = (await c.query(`select prosrc from pg_proc where proname='claim_document_upload' and pronamespace='smartgov'::regnamespace`)).rows[0]?.prosrc;
console.log(src ? src.split("\n").slice(0,90).join("\n") : "NOT FOUND");
await c.end();
