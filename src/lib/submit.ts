import { charterNumber, slugify } from "@/lib/utils";
import type { OrgDraft } from "@/lib/store";

export type SubmitResult =
  | { status: "ok"; organizationId: string; charter: string; persisted: true }
  | { status: "local"; charter: string; persisted: false; reason: string };

type RpcResponse = {
  organizationId: string;
  charterNumber: string;
  slug: string;
  unitCount: number;
};

/**
 * Creates the organization, its founding officer, and its governance units in a
 * single database transaction via the `create_organization` RPC.
 *
 * The RPC is the only write path the publishable key can reach: every table sits
 * behind RLS with no policies, so the client cannot insert directly. It also
 * resolves `slug` / `charter_number` collisions server-side, which is why the
 * values it returns can differ from the ones generated here.
 *
 * It is reached over `/api/organization` rather than a direct client call so
 * `@supabase/supabase-js` stays out of this module's import graph, and with it
 * out of the browser bundle of every page in the setup flow.
 *
 * Falls back to a local-only result when Supabase is unreachable so the
 * prototype flow always completes.
 */
export async function submitOrganization(
  draft: OrgDraft,
  existingCharter: string | null,
): Promise<SubmitResult> {
  const charter = existingCharter ?? charterNumber(draft.organization.name);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return {
      status: "local",
      charter,
      persisted: false,
      reason: "Database not configured — charter issued locally.",
    };
  }

  const federated = draft.model === "federated";

  let res: Response;
  try {
    res = await fetch("/api/organization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: slugify(draft.organization.name) || "student-organization",
        organizationName: draft.organization.name.trim(),
        description: draft.organization.description.trim(),
        governanceModel: draft.model,
        academicYear: draft.organization.academicYear.trim(),
        accent: draft.organization.accent,
        universityName: draft.institution.universityName.trim(),
        campusName: federated ? draft.institution.campusName.trim() : "",
        college: federated ? draft.institution.college.trim() : "",
        sealName: draft.institution.sealName ?? "",
        charterNumber: charter,
        officerName: draft.account.fullName.trim(),
        officerEmail: draft.account.email.trim(),
        officerRole: draft.account.role,
        units: federated
          ? [
              {
                name: `${draft.institution.universityName.trim()} — University Student Government`,
                unitType: "usg",
              },
            ]
          : [{ name: draft.organization.name.trim(), unitType: "council" }],
      }),
    });
  } catch {
    return {
      status: "local",
      charter,
      persisted: false,
      reason: "Could not reach the server — charter issued locally.",
    };
  }

  const data = (await res.json().catch(() => ({}))) as Partial<RpcResponse> & {
    message?: string;
  };

  if (!res.ok || typeof data.organizationId !== "string") {
    return {
      status: "local",
      charter,
      persisted: false,
      reason: data.message ?? "Could not write to the database.",
    };
  }

  return {
    status: "ok",
    organizationId: data.organizationId,
    charter: data.charterNumber || charter,
    persisted: true,
  };
}

export type RegisterAccountResult = { ok: true } | { ok: false; reason: string };

/**
 * Turns the administrator details collected in the setup flow into a
 * login-capable account.
 *
 * Runs after `submitOrganization` because the account is linked to the
 * organization row. `accountKind` comes from the governance model: federated
 * (decentralized) accounts land on the USG dashboard, unitary (centralized) on
 * the central one.
 */
export async function registerAccount(
  draft: OrgDraft,
  organizationId: string,
): Promise<RegisterAccountResult> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: draft.account.email.trim(),
      password: draft.account.password,
      displayName: draft.account.fullName.trim(),
      accountKind: draft.model === "unitary" ? "central" : "usg",
      organizationId,
      universityName: draft.institution.universityName.trim(),
      campusName: draft.institution.campusName.trim(),
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok) {
    return {
      ok: false,
      reason: data.message ?? "The sign-in account could not be created.",
    };
  }

  return { ok: true };
}
