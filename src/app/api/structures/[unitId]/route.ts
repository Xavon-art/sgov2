import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * Everything one unit's structure page needs, in one answer.
 *
 * The unit id in the path is a resource, not a scope: `get_structure` asks
 * `gov_unit_access` what this caller may do with it and reports a unit they
 * cannot read as `not_found` rather than `forbidden`, so the path cannot be used
 * to discover that another council exists.
 *
 * `view=roster` is the seat picker. It is scoped by `gov_people_unit_ids` rather
 * than by the caller's own unit, which is what stops an LSG officer paging a
 * sibling council's personnel one roster row at a time.
 */

type StructureResult = RpcResult & { detail?: string };

function badRequest(message: string) {
  return NextResponse.json({ ok: false, message }, { status: 400 });
}

export async function GET(req: Request, ctx: { params: Promise<{ unitId: string }> }) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const { unitId } = await ctx.params;
  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "";

  // A uuid check rather than a database error: PostgREST would answer a
  // malformed path segment with 400 and a message about a function signature,
  // which is both a worse error to show and a hint about what exists behind it.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(unitId)) {
    return badRequest("That is not a unit.");
  }

  try {
    if (view === "roster") {
      const res = await callRpc<StructureResult>("list_structure_roster", {
        p_session_token: token,
        p_unit_id: unitId,
      });
      // A caller with no organization has no roster to narrow. The builder shows
      // an empty picker with an explanation instead of an error.
      if (!res.ok && (res.reason === "no_organization" || res.reason === "invalid_request")) {
        return NextResponse.json({ ok: true, scope: "unit", roster: [] });
      }
      return NextResponse.json(res);
    }

    if (view === "holder") {
      const email = url.searchParams.get("email") ?? "";
      if (!email.includes("@")) return badRequest("Enter a valid email address.");
      const res = await callRpc<StructureResult>("match_structure_holder", {
        p_session_token: token,
        p_unit_id: unitId,
        p_email: email,
      });
      return NextResponse.json(res);
    }

    if (view !== "") return badRequest("That is not a structure view.");

    const res = await callRpc<StructureResult>("get_structure", {
      p_session_token: token,
      p_unit_id: unitId,
    });
    return NextResponse.json(res);
  } catch (error) {
    console.error("[structures:unit]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load that structure." },
      { status: 500 },
    );
  }
}