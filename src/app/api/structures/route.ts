import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * `RpcResult` plus the validator's own sentence. `detail` names the committee at
 * fault -- "Committee 2 has no usable key" -- which is the difference between a
 * form that tells an officer what to fix and one that says "something went
 * wrong". The client decides whether to trust it; see `structureError` in
 * `@/lib/structure`, which only passes it through for the validation reasons.
 */
type StructureResult = RpcResult & { detail?: string };

/**
 * The session-wide structure reads and all five writes, in one route.
 *
 * `view` is not a scope parameter. Unlike the dashboard's route -- which takes
 * nothing, so that no screen can ask for a wider view than the database decided
 * -- this one has to name a resource, because there are eleven session-taking
 * functions and eleven files would be a directory of near-identical wrappers.
 * `view` only chooses *which* function runs; each one re-derives the caller's
 * scope from the session and none of them accepts a scope to widen itself with.
 *
 * `action` on the POST is the same idea: a dispatch rather than a permission.
 * Nothing here decides who may do what -- `save_structure_draft`,
 * `submit_structure`, `review_structure` and `request_structure_renewal` each
 * check it themselves, and they are the only thing that has. A route that
 * duplicated those rules would be a second, driftable copy of the gate.
 */

const VALID_ACTIONS = ["save", "submit", "review", "renew", "template"] as const;

type Action = (typeof VALID_ACTIONS)[number];

function isAction(value: unknown): value is Action {
  return typeof value === "string" && (VALID_ACTIONS as readonly string[]).includes(value);
}

export async function GET(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const view = new URL(req.url).searchParams.get("view") ?? "";

  try {
    if (view === "templates") {
      const res = await callRpc<StructureResult>("list_structure_templates", {
        p_session_token: token,
      });
      return NextResponse.json(res);
    }

    if (view === "own") {
      // The Manage screen embeds the editor, so it needs the caller's own unit
      // without naming one. `unit_chart` already narrows the answer to the
      // seats this session holds; the same root/lsg pick the full pages use is
      // repeated here so the embedded editor cannot show a wider unit than the
      // standalone one.
      const chart = await callRpc<
        | { ok: true; root: { id: string; name: string } | null; units: Array<{ id: string; name: string; unitType: string }> }
        | { ok: false; reason: string }
      >("unit_chart", { p_session_token: token });

      if (!chart.ok) {
        return NextResponse.json(
          { ok: false, message: "We could not find your unit.", reason: chart.reason },
          { status: chart.reason === "no_unit" ? 404 : 400 },
        );
      }

      const isOwner = await callRpc<{ ok: boolean; accountScope?: string }>("account_workspace_role", {
        p_session_token: token,
      }).then((r) => r.ok && r.accountScope === "owner").catch(() => false);

      const belowRoot = chart.root ? chart.units.filter((u) => u.id !== chart.root?.id) : chart.units;
      const own = isOwner
        ? chart.root ?? belowRoot[0]
        : belowRoot.find((u) => u.unitType === "lsg") ?? belowRoot[0] ?? chart.root;

      if (!own) {
        return NextResponse.json(
          { ok: false, message: "Your account is not seated in a council yet.", reason: "no_unit" },
          { status: 404 },
        );
      }

      const res = await callRpc<StructureResult>("get_structure", {
        p_session_token: token,
        p_unit_id: own.id,
      });
      return NextResponse.json(res);
    }

    if (view === "queue") {
      const res = await callRpc<StructureResult>("list_structure_queue", {
        p_session_token: token,
      });
      // `no_organization` is an answer, not a failure: an officer with no
      // organization yet gets an empty queue and a dashboard that says so,
      // rather than an error they cannot act on.
      if (!res.ok && res.reason === "no_organization") {
        return NextResponse.json({
          ok: true,
          isReviewer: false,
          pending: [],
          decided: [],
          drafts: [],
        });
      }
      return NextResponse.json(res);
    }

    return NextResponse.json(
      { ok: false, message: "That is not a structure view." },
      { status: 400 },
    );
  } catch (error) {
    console.error("[structures:read]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load your structures." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Something went wrong. Please try again." },
      { status: 400 },
    );
  }

  if (!isAction(body.action)) {
    return NextResponse.json(
      { ok: false, message: "That is not a structure action." },
      { status: 400 },
    );
  }

  // A missing unit id is refused here rather than forwarded as null so the
  // database answers `invalid_request` for a document and never for a null.
  const unitId = typeof body.unitId === "string" ? body.unitId : "";
  const structureId = typeof body.structureId === "string" ? body.structureId : "";

  try {
    switch (body.action) {
      case "save":
        return NextResponse.json(
          await callRpc<StructureResult>("save_structure_draft", {
            p_session_token: token,
            p_unit_id: unitId,
            p_template_key: text(body.templateKey),
            p_term_label: text(body.termLabel),
            p_starts_on: date(body.startsOn),
            p_ends_on: date(body.endsOn),
            p_document: body.document ?? {},
            p_note: text(body.note),
          }),
        );

      case "submit":
        return NextResponse.json(
          await callRpc<StructureResult>("submit_structure", {
            p_session_token: token,
            p_structure_id: structureId,
            p_note: text(body.note),
          }),
        );

      case "review": {
        const decision = text(body.decision);
        if (decision !== "approved" && decision !== "returned" && decision !== "rejected") {
          return NextResponse.json(
            { ok: false, message: "That is not a decision." },
            { status: 400 },
          );
        }
        return NextResponse.json(
          await callRpc<StructureResult>("review_structure", {
            p_session_token: token,
            p_structure_id: structureId,
            p_decision: decision,
            p_remark: text(body.remark),
          }),
        );
      }

      case "renew":
        return NextResponse.json(
          await callRpc<StructureResult>("request_structure_renewal", {
            p_session_token: token,
            p_unit_id: unitId,
            p_term_label: text(body.termLabel),
            p_starts_on: date(body.startsOn),
            p_ends_on: date(body.endsOn),
          }),
        );

      case "template":
        return NextResponse.json(
          await callRpc<StructureResult>("import_structure_template", {
            p_session_token: token,
            p_key: text(body.key),
            p_name: text(body.name),
            p_description: text(body.description),
            p_category: text(body.category),
            p_document: body.document ?? {},
          }),
        );
    }
  } catch (error) {
    console.error(`[structures:${body.action}]`, error);
    return NextResponse.json(
      { ok: false, message: "We could not save that. Please try again." },
      { status: 500 },
    );
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Dates go over as null rather than "" when absent, because Postgres `date`
 * cannot cast an empty string and the renewal path wants to default them.
 */
function date(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}