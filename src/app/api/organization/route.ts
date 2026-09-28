import { NextResponse } from "next/server";
import { callRpc } from "@/lib/auth/rpc";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** The write path is a `SECURITY DEFINER` call into Postgres. */
export const runtime = "nodejs";

/**
 * Unauthenticated, so it is the cheapest write in the app for anyone holding
 * the publishable key. The tighter ceiling is in the database
 * (`smartgov.create_organization` consults `consume_rate_limit` directly, so it
 * holds for a caller going straight to PostgREST and never reaching this file);
 * this layer is per-host and set for a shared campus connection.
 */
const IP_LIMIT = 12;
const IP_WINDOW_MS = 10 * 60_000;

type Unit = { name?: string; unitType?: string };

type CreateBody = {
  slug?: string;
  organizationName?: string;
  description?: string;
  governanceModel?: string;
  academicYear?: string;
  accent?: string;
  universityName?: string;
  campusName?: string;
  college?: string;
  sealName?: string;
  charterNumber?: string;
  officerName?: string;
  officerEmail?: string;
  officerRole?: string;
  units?: Array<Unit | null>;
};

type RpcResponse = {
  organizationId: string;
  charterNumber: string;
  slug: string;
  unitCount: number;
};

const GOVERNANCE_MODELS = ["federated", "unitary"];
const MEMBER_ROLES = ["usg_officer", "lsg_officer", "council_officer", "advisor"];
const UNIT_TYPES = ["usg", "lsg", "college", "campus", "council"];

/**
 * Creates the organization, its founding officer, and its governance units.
 *
 * The setup flow runs in the browser, but the tables are RLS-locked with no
 * `anon` policy, so this exists purely to keep `@supabase/supabase-js` out of
 * the client bundle. The browser posts the finished draft; the whole
 * `create_organization` transaction happens here, which also means the returned
 * `charterNumber` is the collision-resolved one the client asked for.
 *
 * Shape is checked before the call because the function reports a bad payload
 * by raising, and its message names the fields it rejected -- safe to echo back
 * here, but not something the client should be the only guard against.
 */
export async function POST(req: Request) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ ok: false, message: "Malformed request." }, { status: 400 });
  }

  const limit = rateLimit(`organization:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: "Too many organizations created from this connection. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const text = (value: string | undefined) => value?.trim() ?? "";

  const organizationName = text(body.organizationName);
  const academicYear = text(body.academicYear);
  const universityName = text(body.universityName);
  const charterNumber = text(body.charterNumber);
  const officerName = text(body.officerName);
  const officerEmail = text(body.officerEmail);
  const governanceModel = text(body.governanceModel);
  const officerRole = text(body.officerRole);

  const missing: string[] = [];
  if (!organizationName) missing.push("organization name");
  if (!academicYear) missing.push("academic year");
  if (!universityName) missing.push("university name");
  if (!charterNumber) missing.push("charter number");
  if (!officerName) missing.push("officer name");
  if (!officerEmail) missing.push("officer email");

  if (missing.length) {
    return NextResponse.json(
      { ok: false, message: `Missing required field(s): ${missing.join(", ")}.` },
      { status: 400 },
    );
  }

  if (!GOVERNANCE_MODELS.includes(governanceModel)) {
    return NextResponse.json(
      { ok: false, message: "Select a governance model to continue." },
      { status: 400 },
    );
  }

  if (!MEMBER_ROLES.includes(officerRole)) {
    return NextResponse.json({ ok: false, message: "Select your role." }, { status: 400 });
  }

  const units = (Array.isArray(body.units) ? body.units : [])
    .map((unit) => ({ name: text(unit?.name), unitType: text(unit?.unitType) }))
    .filter((unit) => unit.name !== "");

  if (!units.length || units.some((unit) => !UNIT_TYPES.includes(unit.unitType))) {
    return NextResponse.json(
      { ok: false, message: "Your organization needs at least one named governance unit." },
      { status: 400 },
    );
  }

  try {
    const created = await callRpc<RpcResponse>("create_organization", {
      p_payload: {
        slug: text(body.slug),
        organizationName,
        description: text(body.description),
        governanceModel,
        academicYear,
        accent: text(body.accent),
        universityName,
        campusName: text(body.campusName),
        college: text(body.college),
        sealName: text(body.sealName),
        charterNumber,
        officerName,
        officerEmail,
        officerRole,
        units,
      },
    });

    return NextResponse.json(created);
  } catch (error) {
    console.error("[organization:create]", error);
    return NextResponse.json(
      { ok: false, message: "We could not create your organization." },
      { status: 500 },
    );
  }
}
