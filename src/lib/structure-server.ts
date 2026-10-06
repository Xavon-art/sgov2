/**
 * Reads one unit's structure from Postgres, for a server component.
 *
 * `get_structure` re-derives the caller's scope from the session, so this calls
 * it directly with the server-side token instead of going out to our own HTTP
 * route and back. The route exists for the browser; a server component has the
 * token in hand and does not need the loop.
 *
 * A refused call returns null rather than a reason: `reason` is a machine code
 * that must not reach a page, and the caller renders one state either way.
 */
import { callRpc } from "@/lib/auth/rpc";
import type { StructureReadPayload } from "@/lib/structure";

export async function fetchStructureForSession(
  sessionToken: string,
  unitId: string,
): Promise<StructureReadPayload | null> {
  try {
    const res = await callRpc<StructureReadPayload>("get_structure", {
      p_session_token: sessionToken,
      p_unit_id: unitId,
    });
    return res.ok ? res : null;
  } catch (error) {
    console.error("[structures:read]", error);
    return null;
  }
}