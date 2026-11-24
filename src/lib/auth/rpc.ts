import "server-only";
import { Pool } from "pg";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/**
 * Thin wrapper over the `SECURITY DEFINER` functions in
 * `supabase/migrations/20260101000200_auth_and_invitations.sql`.
 *
 * The publishable key cannot touch the `smartgov` tables directly -- they are
 * RLS-enabled with no policies for `anon` -- so these functions are the only
 * path in or out of the account data.
 *
 * Transport failures throw; a function that runs but answers `{ ok: false }`
 * resolves normally. Keeping those apart matters: the first is a bug, the
 * second is an expected answer like "wrong password".
 *
 * The fast path calls Postgres directly from the server. The old REST path is
 * kept only as a fallback when no server-side database URL is configured. A
 * direct call avoids a full PostgREST round trip on every dashboard fetch.
 */

type RpcSignature = {
  names: string[] | null;
  arity: number;
};

const globalForRpc = globalThis as unknown as {
  __smartgovRpcPool?: Pool;
  __smartgovRpcSignatures?: Map<string, RpcSignature[]>;
};

function databaseUrl(): string | null {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function pool(): Pool {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not configured.");
  if (!globalForRpc.__smartgovRpcPool) {
    const next = new Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
      application_name: "smartgov_rpc",
    });
    next.on("error", (error: Error) => {
      console.error("[rpc] idle client error", error);
    });
    globalForRpc.__smartgovRpcPool = next;
  }
  return globalForRpc.__smartgovRpcPool;
}

function signatures(): Map<string, RpcSignature[]> {
  if (!globalForRpc.__smartgovRpcSignatures) {
    globalForRpc.__smartgovRpcSignatures = new Map();
  }
  return globalForRpc.__smartgovRpcSignatures;
}

async function signatureFor(name: string, arity: number): Promise<RpcSignature | null> {
  const cache = signatures();
  const cached = cache.get(name);
  if (cached) return cached.find((item) => item.arity === arity) ?? null;
  const { rows } = await pool().query<{
    proname: string;
    proargnames: string[] | null;
    pronargs: number;
  }>(
    `select p.proname, p.proargnames, p.pronargs
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = $1
        and p.prokind = 'f'
      order by p.pronargs, p.oid`,
    [name],
  );
  const found = rows.map((row) => ({ names: row.proargnames, arity: Number(row.pronargs) }));
  cache.set(name, found);
  return found.find((item) => item.arity === arity) ?? null;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function callDirect<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const arity = Object.keys(args).length;
  const signature = await signatureFor(fn, arity);
  const params = signature?.names?.length ? signature.names.map((key) => args[key]) : Object.values(args);
  if (signature?.names?.length && params.some((value) => value === undefined)) {
    throw new Error(`RPC "${fn}" is missing an argument.`);
  }
  const placeholders = params.map((_, index) => `$${index + 1}`).join(", ");
  const { rows } = await pool().query<{ result: T }>(
    `select public.${quoteIdentifier(fn)}(${placeholders}) as result`,
    params,
  );
  return rows[0]?.result as T;
}

export async function callRpc<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  try {
    if (databaseUrl()) return await callDirect<T>(fn, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`RPC "${fn}" failed: ${message}`);
  }

  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      `Supabase is not configured, so "${fn}" cannot run. Check .env.local.`,
    );
  }

  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    throw new Error(`RPC "${fn}" failed: ${error.message}`);
  }
  return data as T;
}

export type RpcResult = { ok: boolean; reason?: string } & Record<string, unknown>;
