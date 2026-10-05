import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/Button";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import { currentAccount, readSessionToken } from "@/lib/auth/session";
import { resolveWorkspaceRole } from "@/lib/auth/workspace";

export const dynamic = "force-dynamic";

type ProposalRow = {
  id: string;
  title: string;
  status: string;
  eventDate: string | null;
  latestRemark: string | null;
};

type ProposalsPayload = RpcResult & { proposals?: ProposalRow[] };

/**
 * What the statuses mean for the person holding the phone.
 *
 * Only three of these are things an LSG officer can act on. `submitted` and
 * `under_review` are USG's turn, not ours, and listing them as "needs action"
 * would be the single most demoralizing thing this dashboard could do.
 */
const ACTION: Record<string, { verb: string; detail: string } | undefined> = {
  draft: { verb: "Finish and submit", detail: "Not sent to USG yet" },
  needs_revision: { verb: "Revise and resubmit", detail: "USG sent this back" },
  approved: { verb: "Publish to feed", detail: "Approved, not announced yet" },
};

const COUNTED: Record<string, string> = {
  submitted: "With USG",
  under_review: "With USG",
  approved: "Approved",
  rejected: "Rejected",
  needs_revision: "Sent back",
  draft: "Drafts",
  published: "Published",
};

export default async function LsgTodayPage() {
  const account = await currentAccount();
  if (!account) redirect("/login");

  const role = await resolveWorkspaceRole();
  if (!role) redirect("/login");
  if (role.side !== "lsg") redirect("/usg");

  let proposals: ProposalRow[] = [];
  try {
    const token = await readSessionToken();
    const data = await callRpc<ProposalsPayload>("list_proposals", {
      p_session_token: token,
    });
    if (data.ok && Array.isArray(data.proposals)) proposals = data.proposals;
  } catch {
    proposals = [];
  }

  const actionable = proposals
    .filter((p) => ACTION[p.status])
    .sort((a, b) => (a.eventDate ?? "9999").localeCompare(b.eventDate ?? "9999"));

  const counts = new Map<string, number>();
  for (const p of proposals) {
    const label = COUNTED[p.status];
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const strip = [...counts.entries()];

  return (
    <section className="mx-auto w-full max-w-2xl">
      <header className="border-b border-line/80 pb-4">
        <p className="eyebrow">{role.unitName ? `${role.unitName} LSG` : "Your LSG"}</p>
        <h1 className="mt-1 text-[1.5rem] leading-tight sm:text-[1.75rem]">Today</h1>
        <p className="mt-1 text-[0.9375rem] leading-relaxed text-body">
          What your unit owes USG, and by when.
        </p>
      </header>

      {strip.length > 0 ? (
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {strip.map(([label, count]) => (
            <div key={label} className="rounded-card border border-line bg-paper px-4 py-3">
              <dt className="text-[0.8125rem] text-muted">{label}</dt>
              <dd className="mt-0.5 font-display text-[1.5rem] leading-none">{count}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <h2 className="mt-8 text-[1.125rem] leading-tight">Needs your action</h2>

      {actionable.length === 0 ? (
        <div className="mt-3 rounded-card border border-line bg-paper px-4 py-6">
          <p className="text-[0.9375rem] leading-relaxed text-body">
            Nothing is waiting on you right now. When USG assigns a task, sends a proposal back, or
            approves one, it will appear here.
          </p>
          <div className="mt-4">
            <ButtonLink href="/lsg/proposals" variant="outline" size="md">
              Start a proposal
            </ButtonLink>
          </div>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {actionable.map((p) => {
            const action = ACTION[p.status]!;
            return (
              <li key={p.id} className="rounded-card border border-line bg-paper p-4">
                <p className="text-[0.8125rem] text-muted">{action.detail}</p>
                <h3 className="mt-0.5 text-[1.0625rem] leading-snug">{p.title}</h3>
                {p.latestRemark ? (
                  <p className="mt-2 border-l-2 border-brass/60 pl-3 text-[0.9375rem] leading-relaxed text-body">
                    {p.latestRemark}
                  </p>
                ) : null}
                <div className="mt-4">
                  <Link
                    href="/lsg/proposals"
                    className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-[0.9375rem] text-paper transition-colors hover:bg-ink-deep"
                  >
                    {action.verb}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Feed, tasks and calendar arrive in later slices. They are listed as what
          is coming rather than rendered empty, so the shape of this page is
          visible to whoever reviews it. */}
    </section>
  );
}