import { NextResponse } from "next/server";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { messageFor } from "@/lib/auth/messages";
import { readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * Officer profile fields for the federated workspace.
 *
 * Four fields describe the person; they are not identity and not authority.
 * `GET` with no query reads the caller's own fields. `GET?scope=all` reads the
 * federation roster, which the database restricts to the USG side. `PATCH`
 * edits the caller's own fields only: there is no account id in the body, and
 * identity/role/status keys are refused before any RPC is made.
 */
type OfficerProfile = {
  fullName: string;
  campusDepartment: string;
  program: string;
  position: string;
};

type OfficerRow = OfficerProfile & {
  accountId: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
};

type ProfilePayload = RpcResult & {
  profile?: OfficerProfile;
  rows?: OfficerRow[];
};

const IMMUTABLE_KEYS = [
  "email",
  "role",
  "accountId",
  "account_id",
  "id",
  "organizationId",
  "organization_id",
  "unitId",
  "unit_id",
  "unit",
  "status",
  "accountScope",
  "account_scope",
  "accountKind",
  "account_kind",
  "userId",
  "user_id",
] as const;

const IMMUTABLE_SET = new Set<string>(IMMUTABLE_KEYS);

function statusForReason(reason?: string): number {
  switch (reason) {
    case "unauthenticated":
      return 401;
    case "forbidden":
    case "no_organization":
      return 403;
    case "invalid_officer_field":
    case "invalid_request":
      return 400;
    default:
      return 400;
  }
}

export async function GET(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  const scope = new URL(request.url).searchParams.get("scope") ?? "self";

  try {
    if (scope === "all") {
      const res = await callRpc<ProfilePayload>("list_officer_profiles", {
        p_session_token: token,
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, reason: res.reason, message: messageFor(res.reason) },
          { status: statusForReason(res.reason) },
        );
      }
      return NextResponse.json({ ok: true, rows: res.rows ?? [] });
    }

    const res = await callRpc<ProfilePayload>("get_officer_profile", {
      p_session_token: token,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, profile: res.profile ?? null });
  } catch (error) {
    console.error("[profile:officer:read]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load the officer profile." },
      { status: 500 },
    );
  }
}

type Body = Record<string, unknown>;

function field(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(request: Request) {
  const token = await readSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  }

  let body: Body;
  try {
    body = ((await request.json()) ?? {}) as Body;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const attempted = Object.keys(body).find((key) => IMMUTABLE_SET.has(key));
  if (attempted) {
    return NextResponse.json(
      {
        ok: false,
        reason: "immutable_field",
        field: attempted,
        message: messageFor("immutable_field"),
      },
      { status: 400 },
    );
  }

  try {
    const res = await callRpc<ProfilePayload>("update_officer_profile", {
      p_session_token: token,
      p_full_name: field(body.fullName),
      p_campus_department: field(body.campusDepartment),
      p_program: field(body.program),
      p_position: field(body.position),
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: res.reason, message: messageFor(res.reason) },
        { status: statusForReason(res.reason) },
      );
    }
    return NextResponse.json({ ok: true, profile: res.profile ?? null });
  } catch (error) {
    console.error("[profile:officer:write]", error);
    return NextResponse.json(
      { ok: false, message: "We could not save that change." },
      { status: 500 },
    );
  }
}
