import { charterNumber, slugify } from "@/lib/utils";
import { effectiveRole, type OrgDraft } from "@/lib/store";

export type SubmitResult =
  | { status: "ok"; organizationId: string; charter: string; persisted: true }
  | { status: "local"; charter: string; persisted: false; reason: string };

type RpcResponse = {
  organizationId: string;
  charterNumber: string;
  slug: string;
  unitCount: number;
};

/** The seal color a new organization is issued when nobody picks one. */
export const DEFAULT_ACCENT = "#16324f";

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
  const charter = existingCharter ?? charterNumber(draft.organizationName);

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
        slug: slugify(draft.organizationName) || "student-organization",
        organizationName: draft.organizationName.trim(),
        description: draft.organizationDescription.trim(),
        governanceModel: draft.model,
        academicYear: draft.academicYear.trim(),
        // The accent was a theme-picker choice; that step is gone, so the
        // organization's seal keeps the product default rather than carrying a
        // field in the draft that nothing can set.
        accent: DEFAULT_ACCENT,
        universityName: draft.institution.universityName.trim(),
        // Optional fields, sent as typed. Blank is a valid answer: a USG that
        // covers the whole university has no single campus to name, and the
        // federated units below carry their own names.
        campusName: draft.institution.campusName.trim(),
        college: draft.institution.college.trim(),
        sealName: "",
        charterNumber: charter,
        officerName: draft.account.fullName.trim(),
        officerEmail: draft.account.email.trim(),
        // Re-derived here rather than trusted from the draft, because a
        // persisted draft is user-writable and setModel never runs for one
        // that was hand-edited.
        officerRole: effectiveRole(draft.model, draft.account.role),
        // The USG root row is derived from the organization name inside the
        // function, so this sends the declared children and nothing else.
        units: federated
          ? draft.units.map((unit) => ({
              name: unit.name.trim(),
              type: unit.type,
            }))
          : [{ name: draft.organizationName.trim(), unitType: "council" }],
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

export type RegisterAccountResult =
  | {
      ok: true;
      verifyToken: string;
      email: string;
      organizationName: string;
    }
  | { ok: false; reason: string };

/**
 * Turns the administrator details collected in the setup flow into a
 * registration that is waiting on its activation email.
 *
 * Runs after `submitOrganization` because the account is linked to the
 * organization row. `accountKind` comes from the governance model: federated
 * (decentralized) accounts land on the USG dashboard, unitary (centralized) on
 * the central one.
 *
 * The returned `verifyToken` is the registrant's one-time key to the activation
 * link; it is stored for this session only and never emailed. The account is not
 * approved yet — `/activate` does that.
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
      // Optional, and separate from the units: this names the founding account's
      // home, while an invited officer's campus arrives with their invitation.
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

  if (typeof data.verifyToken !== "string" || !data.verifyToken) {
    return {
      ok: false,
      reason: "We could not start verification. Please try again.",
    };
  }

  return {
    ok: true,
    verifyToken: data.verifyToken,
    email: typeof data.email === "string" ? data.email : "",
    organizationName: typeof data.organizationName === "string" ? data.organizationName : "",
  };
}
