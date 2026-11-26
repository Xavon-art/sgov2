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
  setReturning: boolean;
};

const globalForRpc = globalThis as unknown as {
  __smartgovRpcPool?: Pool;
  __smartgovRpcSignatures?: Map<string, RpcSignature[]>;
  __smartgovRpcDirectUnavailable?: boolean;
};

function databaseUrl(): string | null {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

/**
 * A direct Postgres URL is a speed optimisation, not the only way to reach the
 * functions. If its TLS chain cannot be verified (or the host is unreachable),
 * fall through to the configured Supabase REST path instead of weakening the
 * certificate check just to keep the fast path alive.
 */
function isDirectTransportFailure(error: unknown): boolean {
  const code = typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    /^(ERR_TLS|SELF_SIGNED|UNABLE_TO_VERIFY|CERT_|DEPTH_ZERO|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EPIPE|EAI_AGAIN)/.test(code) ||
    /self[- ]signed|certificate|TLS|SSL|connection (?:timed out|refused)|getaddrinfo/i.test(message)
  );
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
      // `true` keeps Node's default certificate verification. Local development
      // URLs are the only plain-text exception; a bad remote chain falls back
      // to Supabase rather than being silently accepted here.
      ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : true,
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

function inputNames(
  names: string[] | null,
  modes: unknown,
  arity: number,
): string[] | null {
  if (!names?.length) return null;
  const modeList = typeof modes === "string"
    ? modes.replace(/^\{|\}$/g, "").split(",")
    : Array.isArray(modes)
      ? modes.map(String)
      : null;
  const selected = modeList?.length === names.length
    ? names.filter((_, index) => ["i", "b", "v"].includes(modeList[index]))
    : names.slice(0, arity);
  return selected.length === arity ? selected : null;
}

async function signatureFor(name: string, arity: number): Promise<RpcSignature | null> {
  const cache = signatures();
  const cached = cache.get(name);
  if (cached) return cached.find((item) => item.arity === arity) ?? null;
  const { rows } = await pool().query<{
    proname: string;
    proargnames: string[] | null;
    proargmodes: unknown;
    pronargs: number;
    proretset: boolean;
  }>(
    `select p.proname, p.proargnames, p.proargmodes, p.pronargs, p.proretset
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = $1
         and p.prokind = 'f'
       order by p.pronargs, p.oid`,
    [name],
  );
  const found = rows.map((row) => {
    const size = Number(row.pronargs);
    return {
      names: inputNames(row.proargnames, row.proargmodes, size),
      arity: size,
      setReturning: Boolean(row.proretset),
    };
  });
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
  const call = `public.${quoteIdentifier(fn)}(${placeholders})`;
  const sql = signature?.setReturning
    ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as result from ${call} as t`
    : `select ${call} as result`;
  const { rows } = await pool().query<{ result: T }>(sql, params);
  return rows[0]?.result as T;
}

export async function callRpc<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  try {
    if (databaseUrl() && !globalForRpc.__smartgovRpcDirectUnavailable) {
      return await callDirect<T>(fn, args);
    }
  } catch (error) {
    if (!isDirectTransportFailure(error)) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`RPC "${fn}" failed: ${message}`);
    }
    // Remember the unusable transport for this server process; every call would
    // otherwise pay the same TLS/connection timeout before falling back.
    globalForRpc.__smartgovRpcDirectUnavailable = true;
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
