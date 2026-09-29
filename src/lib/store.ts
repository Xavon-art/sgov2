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
  campusName: string;
  college: string;
};

/**
 * The organization is not a separate step or a separate object any more — there
 * is no Org screen to go back to. Its three remaining fields sit at the root of
 * the draft and are edited on the Units step, beside the councils they describe.
 */
export type OrgDraft = {
  model: GovernanceModel | null;
  account: AccountDraft;
  institution: InstitutionDraft;
  organizationName: string;
  organizationDescription: string;
  academicYear: string;
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
    campusName: "",
    college: "",
  },
  organizationName: "",
  organizationDescription: "",
  academicYear: "",
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

type Store = OrgDraft & {
  charter: string | null;
  organizationId: string | null;
  submittedAt: string | null;
  // One-shot key to the owner OTP flow, kept for the life of the browser tab
  // so a reload of the success step can resume verification. Cleared on
  // approval; never emailed, never written to the database.
  ownerVerify: { verifyToken: string; email: string; organizationName: string } | null;
  // Set by the Review step at the moment the user confirms, and consumed by the
  // Verification step.
  //
  // The verification page is also reachable from a failed sign-in, so it cannot
  // treat "no organization yet" as "go create one" — that would mint a second
  // organization for a person who had simply followed a link. This flag is the
  // explicit permission to write, and it is cleared as soon as it is used.
  confirmIntent: boolean;
  setModel: (model: GovernanceModel) => void;
  patchAccount: (patch: Partial<AccountDraft>) => void;
  patchInstitution: (patch: Partial<InstitutionDraft>) => void;
  patchOrganization: (patch: Partial<OrgDraft>) => void;
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
  requestSubmit: () => void;
  clearSubmitIntent: () => void;
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
      confirmIntent: false,
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
      patchOrganization: (patch) => set((state) => ({ ...state, ...patch })),
      setUnits: (units) => set({ units }),
      setCharter: (charter) => set({ charter }),
      setOrganizationId: (organizationId) => set({ organizationId }),
      setOwnerVerify: (ownerVerify) => set({ ownerVerify }),
      markSubmitted: () => set({ submittedAt: new Date().toISOString() }),
      requestSubmit: () => set({ confirmIntent: true }),
      clearSubmitIntent: () => set({ confirmIntent: false }),
      reset: () =>
        set({
          ...EMPTY_DRAFT,
          charter: null,
          organizationId: null,
          submittedAt: null,
          ownerVerify: null,
          confirmIntent: false,
        }),
    }),
    {
      // v4: the Org step is gone, so its `organization` object is replaced by
      // root-level `organizationName` / `organizationDescription` / `academicYear`
      // fields, and `accent` left with the deleted theme picker. A v3 draft
      // cannot be reshaped by a merge, so it is discarded rather than
      // half-read.
      name: "smartgov.draft.v4",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateStep(id: string, state: OrgDraft): string[] {
  const errors: string[] = [];
  const { model, account, institution, units, organizationName, organizationDescription, academicYear } =
    state;

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

  // The organization fields used to live on their own step. That step is gone,
  // so they are validated on the step that now asks for them.
  if (id === "units") {
    if (organizationName.trim().length < 3)
      errors.push("Enter your organization's name.");
    if (organizationDescription.trim().length < 12)
      errors.push("Add a short description (at least 12 characters).");
    if (!/^\d{4}\s*[–—-]\s*\d{4}$/.test(academicYear.trim()))
      errors.push("Academic year must look like 2026 – 2027.");

    const result = validateUnits(units);
    if (!result.ok && result.reason === "duplicate")
      errors.push("Declared units can't have the same name.");
    else if (!result.ok)
      errors.push("Add at least one college, campus, or department.");
  }

  return errors;
}
