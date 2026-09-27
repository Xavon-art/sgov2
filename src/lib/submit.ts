import { charterNumber, slugify } from "@/lib/utils";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
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
 * Falls back to a local-only result when Supabase is unreachable so the
 * prototype flow always completes.
 */
export async function submitOrganization(
  draft: OrgDraft,
  existingCharter: string | null,
): Promise<SubmitResult> {
  const charter = existingCharter ?? charterNumber(draft.organization.name);

  if (!isSupabaseConfigured || !supabase) {
    return {
      status: "local",
      charter,
      persisted: false,
      reason: "Database not configured — charter issued locally.",
    };
  }

  const federated = draft.model === "federated";

  const { data, error } = await supabase.rpc("create_organization", {
    p_payload: {
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
    },
  });

  if (error || !data) {
    return {
      status: "local",
      charter,
      persisted: false,
      reason: error?.message ?? "Could not write to the database.",
    };
  }

  const result = data as RpcResponse;

  return {
    status: "ok",
    organizationId: result.organizationId,
    charter: result.charterNumber || charter,
    persisted: true,
  };
}
