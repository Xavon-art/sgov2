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
 * resolves normally. Keeping those two apart matters: the first is a bug, the
 * second is an expected answer like "wrong password".
 */
export async function callRpc<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
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

/**
 * Shapes returned by the `smartgov` functions. `reason` is a stable machine
 * code that route handlers map to messages; it is never shown raw.
 */
export type RpcResult = { ok: boolean; reason?: string } & Record<string, unknown>;
