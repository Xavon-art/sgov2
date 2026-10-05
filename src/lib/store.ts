"use client";

import { create } from "zustand";
import { type DraftUnit } from "@/lib/units";

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

/**
 * `campusName` and `college` are optional on purpose, not vestigial.
 *
 * The setup flow renders all three inputs and the review step shows them back, so
 * this is a real three-field step. What is optional is each value: a USG that
 * covers the whole university has no single campus to name, and one that is
 * attached to a college or office may name it. Both are collected because a USG
 * that does have one should not have to fix it after the fact, and blank is a
 * legitimate answer rather than a missing one.
 */
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
  // One-shot key to the owner activation flow, held for the life of the page so
  // the success step can render after the redirect. Never emailed, never
  // written to the database, and gone the moment the page is reloaded -- the
  // activation link already in the user's inbox is the durable copy.
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

/**
 * The setup draft, held in memory only.
 *
 * It deliberately does not persist. A refresh, a second tab, or a stray
 * "reopen closed tab" reloads the module and starts the wizard empty, so a half
 * filled registration -- an administrator's real name, their institution, the
 * councils they declared -- is never left sitting in browser storage where a
 * later visitor on the same machine could read it back out.
 *
 * Client-side navigation between steps is not a reload, so the draft survives
 * moving through the wizard; only the page going away loses it. Refreshing
 * mid-flow sends the user back to the first step via `useStepGuard`, which now
 * has no stored state to validate against.
 */
export const useOrgDraft = create<Store>()((set) => ({
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
}));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateStep(id: string, state: OrgDraft): string[] {
  const errors: string[] = [];
  const { model, account, institution, organizationName, organizationDescription, academicYear } =
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
  // so they are validated on the step that now asks for them. Councils are no
  // longer declared here either, so there is nothing left to validate beyond the
  // organization's own fields.
  if (id === "units") {
    if (organizationName.trim().length < 3)
      errors.push("Enter your organization's name.");
    if (organizationDescription.trim().length < 12)
      errors.push("Add a short description (at least 12 characters).");
    if (!/^\d{4}\s*[–—-]\s*\d{4}$/.test(academicYear.trim()))
      errors.push("Academic year must look like 2026 – 2027.");
  }

  return errors;
}
