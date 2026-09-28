"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { validateUnits, type DraftUnit } from "@/lib/units";

export type GovernanceModel = "federated" | "unitary";

export type MemberRole =
  | "usg_officer"
  | "lsg_officer"
  | "council_officer"
  | "advisor";

export type AccountDraft = {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: MemberRole | "";
};

export type InstitutionDraft = {
  universityName: string;
  sealName: string;
};

export type OrganizationDraft = {
  name: string;
  description: string;
  accent: string;
  academicYear: string;
};

export type OrgDraft = {
  model: GovernanceModel | null;
  account: AccountDraft;
  institution: InstitutionDraft;
  organization: OrganizationDraft;
  units: DraftUnit[];
};

export const EMPTY_DRAFT: OrgDraft = {
  model: null,
  account: {
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "",
  },
  institution: {
    universityName: "",
    sealName: "",
  },
  organization: {
    name: "",
    description: "",
    accent: "#16324f",
    academicYear: "",
  },
  units: [],
};

export const ROLE_LABELS: Record<MemberRole, string> = {
  usg_officer: "USG Officer",
  lsg_officer: "LSG Officer",
  council_officer: "Council Officer",
  advisor: "Faculty Advisor",
};

export const ROLE_HINTS: Record<MemberRole, string> = {
  usg_officer:
    "Presides over the University Student Government and approves council submissions.",
  lsg_officer:
    "Leads a Local Student Government under a college or satellite campus.",
  council_officer:
    "Serves on the single unified student council for the whole institution.",
  advisor: "Faculty adviser with oversight and approval rights.",
};

export function rolesForModel(model: GovernanceModel | null): MemberRole[] {
  if (model === "federated") return ["usg_officer", "lsg_officer", "advisor"];
  if (model === "unitary") return ["council_officer", "advisor"];
  return [];
}

/**
 * The role an account actually gets.
 *
 * Under federated only the USG can register, so the role is known rather than
 * asked -- asking would offer a choice with exactly one correct answer. This
 * resolves it from the model instead of reading it back from the draft, because
 * `setModel` only runs on the model card's onChange and never on mount, so a
 * resumed draft could otherwise carry a stale "LSG Officer" straight through.
 */
export function effectiveRole(
  model: GovernanceModel | null,
  role: MemberRole | "",
): MemberRole | "" {
  if (model === "federated") return "usg_officer";
  return role;
}

export const ACCENTS = [
  { value: "#16324f", label: "Navy" },
  { value: "#1e4d6b", label: "Harbour" },
  { value: "#2f5d50", label: "Laurel" },
  { value: "#5c3a53", label: "Mulberry" },
  { value: "#6b3f2a", label: "Terracotta" },
  { value: "#c9a24b", label: "Brass" },
];

type Store = OrgDraft & {
  charter: string | null;
  organizationId: string | null;
  submittedAt: string | null;
  // One-shot key to the owner OTP flow, kept for the life of the browser tab
  // so a reload of the success step can resume verification. Cleared on
  // approval; never emailed, never written to the database.
  ownerVerify: { verifyToken: string; email: string; organizationName: string } | null;
  setModel: (model: GovernanceModel) => void;
  patchAccount: (patch: Partial<AccountDraft>) => void;
  patchInstitution: (patch: Partial<InstitutionDraft>) => void;
  patchOrganization: (patch: Partial<OrganizationDraft>) => void;
  // One writer, not add/remove/update: both ways into this array -- typing a row
  // and pasting a roster -- hand over a whole new one, so the incremental
  // actions would be three ways to be wrong about the same array.
  setUnits: (units: DraftUnit[]) => void;
  setCharter: (charter: string) => void;
  setOrganizationId: (id: string | null) => void;
  setOwnerVerify: (
    verify: { verifyToken: string; email: string; organizationName: string } | null,
  ) => void;
  markSubmitted: () => void;
  reset: () => void;
};

export const useOrgDraft = create<Store>()(
  persist(
    (set) => ({
      ...EMPTY_DRAFT,
      charter: null,
      organizationId: null,
      submittedAt: null,
      ownerVerify: null,
      setModel: (model) =>
        set((state) => ({
          model,
          // Federated is USG-only, so the role is settled here rather than
          // asked. Unitary keeps the picker, so a role that is no longer
          // available under the new model is cleared.
          account: {
            ...state.account,
            role:
              model === "federated"
                ? "usg_officer"
                : rolesForModel(model).includes(state.account.role as MemberRole)
                  ? state.account.role
                  : "",
          },
        })),
      patchAccount: (patch) =>
        set((state) => ({ account: { ...state.account, ...patch } })),
      patchInstitution: (patch) =>
        set((state) => ({
          institution: { ...state.institution, ...patch },
        })),
      patchOrganization: (patch) =>
        set((state) => ({
          organization: { ...state.organization, ...patch },
        })),
      setUnits: (units) => set({ units }),
      setCharter: (charter) => set({ charter }),
      setOrganizationId: (organizationId) => set({ organizationId }),
      setOwnerVerify: (ownerVerify) => set({ ownerVerify }),
      markSubmitted: () => set({ submittedAt: new Date().toISOString() }),
      reset: () =>
        set({ ...EMPTY_DRAFT, charter: null, organizationId: null, submittedAt: null, ownerVerify: null }),
    }),
    {
      // Bumped from v1: those drafts carry campusName, college, and possibly an
      // "LSG Officer" role, none of which can survive this change. Discarding
      // them is the only way to be sure no stale federated draft reaches the
      // charter step.
      //
      // `units` did NOT earn a v3, and the difference is the point. The v1
      // drafts above held a field the wizard no longer reads, so keeping them
      // would carry a lie forward; a v2 draft only lacks a `units` key, and
      // persist shallow-merges the stored state over these initial values, so
      // such a draft inherits `units: []` and is indistinguishable from a fresh
      // one. Bumping would throw away a half-filled draft for a missing array
      // that already defaults correctly.
      name: "smartgov.draft.v2",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateStep(id: string, state: OrgDraft): string[] {
  const errors: string[] = [];
  const { model, account, institution, organization, units } = state;

  if (id === "governance-model" && !model) {
    errors.push("Select a governance model to continue.");
  }

  if (id === "account") {
    if (account.fullName.trim().length < 2)
      errors.push("Enter your full name.");
    if (!EMAIL_RE.test(account.email.trim()))
      errors.push("Enter a valid email address.");
    if (account.password.length < 8)
      errors.push("Password must be at least 8 characters.");
    if (account.password !== account.confirmPassword)
      errors.push("Passwords do not match.");
    // A federated registrant cannot choose: the USG account is the USG
    // officer by definition, so asking would be asking for a false answer.
    if (!effectiveRole(model, account.role)) errors.push("Select your role.");
  }

  if (id === "institution") {
    if (institution.universityName.trim().length < 2)
      errors.push("Enter your university's name.");
  }

  if (id === "organization") {
    if (organization.name.trim().length < 3)
      errors.push("Enter your organization's name.");
    if (organization.description.trim().length < 12)
      errors.push("Add a short description (at least 12 characters).");
    if (!/^\d{4}\s*[–—-]\s*\d{4}$/.test(organization.academicYear.trim()))
      errors.push("Academic year must look like 2026 – 2027.");
  }

  // Only federated has a local tier, so a unitary organization is not asked to
  // declare one -- the step does not even render for it.
  if (id === "units" && model === "federated") {
    const result = validateUnits(units);
    if (!result.ok && result.reason === "duplicate")
      errors.push("Declared units can't have the same name.");
    else if (!result.ok)
      errors.push("Add at least one college, campus, or department.");
  }

  return errors;
}
