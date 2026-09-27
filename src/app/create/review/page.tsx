"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { StepShell } from "@/components/create/StepShell";
import { OrgDiagram } from "@/components/ui/OrgDiagram";
import { Button } from "@/components/ui/Button";
import { Seal } from "@/components/ui/Seal";
import { IconArrowRight, IconPencil, IconShield } from "@/components/ui/Icons";
import { ROLE_LABELS, useOrgDraft, type MemberRole } from "@/lib/store";
import { STEPS } from "@/lib/steps";
import { useStepGuard } from "@/lib/useStepGuard";
import { charterNumber, cn } from "@/lib/utils";

function Row({
  label,
  value,
  editHref,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  editHref?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line/70 py-3 last:border-b-0">
      <dt className="text-[0.75rem] font-medium tracking-[0.06em] text-muted uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "flex items-baseline gap-3 text-[0.9375rem] text-ink-deep",
          mono && "font-mono text-[0.8125rem]",
        )}
      >
        <span className="text-right">{value || "—"}</span>
        {editHref ? <EditLink href={editHref} label={label} /> : null}
      </dd>
    </div>
  );
}

function EditLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="group inline-flex shrink-0 items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-[0.6875rem] font-medium text-ink-muted transition-colors duration-300 hover:border-line-strong hover:text-ink"
      aria-label={`Edit ${label}`}
    >
      <IconPencil className="h-3 w-3" />
      Edit
    </a>
  );
}

export default function ReviewPage() {
  useStepGuard("review");
  const router = useRouter();
  const draft = useOrgDraft();
  const { charter, setCharter } = draft;

  useEffect(() => {
    if (!charter) setCharter(charterNumber(draft.organization.name));
  }, [charter, draft.organization.name, setCharter]);

  const federated = draft.model === "federated";
  const account = draft.account;
  const inst = draft.institution;
  const org = draft.organization;

  return (
    <StepShell
      step="review"
      tone="bare"
      title="Review your charter"
      lede="Nothing has been submitted yet. Check every line — you can jump back to any step to change something."
    >
      <article className="grain relative overflow-hidden rounded-2xl border border-line-strong/80 bg-paper/85 p-6 shadow-seal backdrop-blur-xl sm:p-9">
        <div aria-hidden className="hairline-grid absolute inset-0 opacity-40" />

        <header className="relative flex flex-col items-center gap-5 border-b border-double border-line-strong/70 pb-8 text-center">
          <Seal
            size={78}
            inscribed
            accent={org.accent}
            className="drop-shadow-[0_8px_24px_rgba(13,33,53,0.16)]"
          />
          <div>
            <p className="eyebrow">Charter of establishment</p>
            <h2 className="mt-3 text-[1.5rem] leading-tight sm:text-[1.875rem]">
              {org.name}
            </h2>
            <p className="mt-2 text-[0.8125rem] text-muted">
              {inst.universityName}
              {federated && inst.campusName ? ` · ${inst.campusName}` : ""}
            </p>
            <p className="mt-3 font-mono text-[0.75rem] tracking-[0.12em] text-brass-deep">
              {charter ?? "SGV-———————"}
            </p>
          </div>
        </header>

        <div className="relative mt-8 grid gap-8 lg:grid-cols-[1fr_15rem]">
          <div className="flex flex-col gap-7">
            <section>
              <h3 className="flex items-center gap-2.5 text-[0.75rem] font-semibold tracking-[0.16em] text-ink-soft uppercase">
                <span aria-hidden className="h-px w-5 bg-brass" />
                Governance
                <EditLink href={STEPS[1].path} label="governance model" />
              </h3>
              <dl className="mt-3">
                <Row
                  label="Model"
                  value={federated ? "Federated / Decentralized" : "Unitary / Centralized"}
                  editHref={STEPS[1].path}
                />
                <Row
                  label="Structure"
                  value={
                    federated
                      ? "USG with Local Student Governments"
                      : "Single student council"
                  }
                />
                <Row
                  label="Academic year"
                  value={org.academicYear}
                  editHref={STEPS[4].path}
                />
              </dl>
            </section>

            <section>
              <h3 className="flex items-center gap-2.5 text-[0.75rem] font-semibold tracking-[0.16em] text-ink-soft uppercase">
                <span aria-hidden className="h-px w-5 bg-brass" />
                Administrator
              </h3>
              <dl className="mt-3">
                <Row
                  label="Full name"
                  value={account.fullName}
                  editHref={STEPS[2].path}
                />
                <Row label="Email" value={account.email} editHref={STEPS[2].path} />
                <Row
                  label="Role"
                  value={ROLE_LABELS[account.role as MemberRole] ?? "—"}
                  editHref={STEPS[2].path}
                />
              </dl>
            </section>

            <section>
              <h3 className="flex items-center gap-2.5 text-[0.75rem] font-semibold tracking-[0.16em] text-ink-soft uppercase">
                <span aria-hidden className="h-px w-5 bg-brass" />
                Institution
              </h3>
              <dl className="mt-3">
                <Row
                  label="University"
                  value={inst.universityName}
                  editHref={STEPS[3].path}
                />
                {federated ? (
                  <>
                    <Row
                      label="Campus or branch"
                      value={inst.campusName}
                      editHref={STEPS[3].path}
                    />
                    <Row
                      label="College or department"
                      value={inst.college}
                      editHref={STEPS[3].path}
                    />
                  </>
                ) : (
                  <Row label="Local units" value="None — unitary structure" />
                )}
                <Row label="Seal" value={inst.sealName || "Not provided"} />
              </dl>
            </section>
          </div>

          <aside className="flex flex-col gap-5 lg:border-l lg:border-line/70 lg:pl-7">
            <div className="rounded-xl border border-line/80 bg-canvas/50 px-3 py-3">
              <p className="eyebrow text-[0.5625rem]">Org chart</p>
              <div className="mt-2.5">
                <OrgDiagram
                  model={federated ? "federated" : "unitary"}
                  accent={org.accent}
                />
              </div>
            </div>

            {org.description ? (
              <div>
                <p className="eyebrow text-[0.5625rem]">Mandate</p>
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-body">
                  {org.description}
                </p>
              </div>
            ) : null}

            <div className="rounded-xl border border-brass/30 bg-brass-soft/20 px-3.5 py-3">
              <p className="flex items-center gap-1.5 text-[0.625rem] font-semibold tracking-[0.1em] text-brass-deep uppercase">
                <IconShield className="h-3.5 w-3.5" />
                Password
              </p>
              <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-soft">
                Set during setup. No authentication is wired up in this build.
              </p>
            </div>
          </aside>
        </div>
      </article>

      <div className="mt-8 flex flex-col items-center gap-4">
        <Button
          type="button"
          size="lg"
          className="w-full sm:w-auto"
          onClick={() => {
            if (!charter) setCharter(charterNumber(org.name));
            window.scrollTo({ top: 0, behavior: "smooth" });
            router.push("/create/success");
          }}
        >
          Confirm and create organization
          <IconArrowRight className="h-4.5 w-4.5 transition-transform duration-500 group-hover:translate-x-1" />
        </Button>
        <p className="text-center text-[0.75rem] text-muted">
          By confirming, this organization is created and its founding officer
          record is written.
        </p>
      </div>
    </StepShell>
  );
}
