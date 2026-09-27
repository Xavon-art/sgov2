"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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
  campusName: string;
  college: string;
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
    campusName: "",
    college: "",
    sealName: "",
  },
  organization: {
    name: "",
    description: "",
    accent: "#16324f",
    academicYear: "",
  },
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
  setModel: (model: GovernanceModel) => void;
  patchAccount: (patch: Partial<AccountDraft>) => void;
  patchInstitution: (patch: Partial<InstitutionDraft>) => void;
  patchOrganization: (patch: Partial<OrganizationDraft>) => void;
  setCharter: (charter: string) => void;
  setOrganizationId: (id: string | null) => void;
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
      setModel: (model) =>
        set((state) => ({
          model,
          account: {
            ...state.account,
            role: rolesForModel(model).includes(state.account.role as MemberRole)
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
      setCharter: (charter) => set({ charter }),
      setOrganizationId: (organizationId) => set({ organizationId }),
      markSubmitted: () => set({ submittedAt: new Date().toISOString() }),
      reset: () => set({ ...EMPTY_DRAFT, charter: null, organizationId: null, submittedAt: null }),
    }),
    {
      name: "smartgov.draft.v1",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateStep(id: string, state: OrgDraft): string[] {
  const errors: string[] = [];
  const { model, account, institution, organization } = state;

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
    if (!account.role) errors.push("Select your role.");
  }

  if (id === "institution") {
    if (institution.universityName.trim().length < 2)
      errors.push("Enter your university's name.");
    if (model === "federated" && institution.campusName.trim().length < 2)
      errors.push("Federated systems require a campus or branch name.");
    if (model === "federated" && institution.college.trim().length < 2)
      errors.push("Federated systems require a college or department.");
  }

  if (id === "organization") {
    if (organization.name.trim().length < 3)
      errors.push("Enter your organization's name.");
    if (organization.description.trim().length < 12)
      errors.push("Add a short description (at least 12 characters).");
    if (!/^\d{4}\s*[–—-]\s*\d{4}$/.test(organization.academicYear.trim()))
      errors.push("Academic year must look like 2026 – 2027.");
  }

  return errors;
}
