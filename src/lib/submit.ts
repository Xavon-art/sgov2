import { charterNumber, slugify } from "@/lib/utils";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { OrgDraft } from "@/lib/store";

export type SubmitResult =
  | { status: "ok"; organizationId: string; charter: string; persisted: true }
  | { status: "local"; charter: string; persisted: false; reason: string };

function requireCharter(existing: string | null, draft: OrgDraft) {
  return existing ?? charterNumber(draft.organization.name);
}

/**
 * Creates the organization, its founding member, and its root governance unit.
 * Falls back to a local-only result when Supabase is not configured so the
 * prototype flow always completes.
 */
export async function submitOrganization(
  draft: OrgDraft,
  existingCharter: string | null,
): Promise<SubmitResult> {
  const charter = requireCharter(existingCharter, draft);

  if (!isSupabaseConfigured || !supabase) {
    return {
      status: "local",
      charter,
      persisted: false,
      reason: "Database not configured — charter issued locally.",
    };
  }

  const base = slugify(draft.organization.name) || "student-organization";

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({
      slug: base,
      name: draft.organization.name.trim(),
      description: draft.organization.description.trim(),
      governance_model: draft.model,
      academic_year: draft.organization.academicYear.trim(),
      accent: draft.organization.accent,
      university_name: draft.institution.universityName.trim(),
      campus_name:
        draft.model === "federated"
          ? draft.institution.campusName.trim() || null
          : null,
      college:
        draft.model === "federated"
          ? draft.institution.college.trim() || null
          : null,
      seal_name: draft.institution.sealName || null,
      charter_number: charter,
      status: "active",
    })
    .select("id")
    .single();

  if (orgError || !org) {
    return {
      status: "local",
      charter,
      persisted: false,
      reason: orgError?.message ?? "Could not write to the database.",
    };
  }

  const organizationId = org.id as string;

  const { error: memberError } = await supabase.from("organization_members").insert({
    organization_id: organizationId,
    full_name: draft.account.fullName.trim(),
    email: draft.account.email.trim().toLowerCase(),
    role: draft.account.role,
    is_founding: true,
  });

  if (memberError) {
    return {
      status: "local",
      charter,
      persisted: false,
      reason: `Organization created, but the member record failed: ${memberError.message}`,
    };
  }

  const { error: unitError } = await supabase.from("governance_units").insert(
    draft.model === "federated"
      ? {
          organization_id: organizationId,
          parent_id: null,
          name: `${draft.institution.universityName.trim()} — University Student Government`,
          unit_type: "usg",
        }
      : {
          organization_id: organizationId,
          parent_id: null,
          name: draft.organization.name.trim(),
          unit_type: "council",
        },
  );

  if (unitError) {
    return {
      status: "local",
      charter,
      persisted: false,
      reason: `Organization created, but the org chart failed: ${unitError.message}`,
    };
  }

  return { status: "ok", organizationId, charter, persisted: true };
}
