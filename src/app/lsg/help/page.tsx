import { redirect } from "next/navigation";
import { currentAccount } from "@/lib/auth/session";
import { resolveWorkspaceRole } from "@/lib/auth/workspace";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    title: "Send a proposal",
    body: "Write down what your unit wants to run, when, and where. Add a budget if the event costs money. Submit it and USG picks it up.",
  },
  {
    title: "USG reviews it",
    body: "USG approves, rejects, or sends it back with a remark explaining what to change. Sending it back is normal, not a rejection of the idea.",
  },
  {
    title: "Revise and send again",
    body: "Open the proposal, change what the remark asked for, and resubmit. Your earlier versions are kept, so nothing is lost.",
  },
  {
    title: "Publish when approved",
    body: "Once USG approves, publish it to the feed so every other unit and all students can see it.",
  },
  {
    title: "Upload what USG asks for",
    body: "USG attaches requirements to a proposal or a task, with the exact file type it will accept. Each one shows its own status.",
  },
];

/**
 * The LSG help page. Static, and deliberately the end of the road.
 *
 * There is no form here and no link to one. An LSG officer who needs an account
 * change, a new officer, or access they have lost cannot get any of it from this
 * side, and offering a control that quietly fails would be worse than saying so
 * in a sentence.
 */
export default async function LsgHelpPage() {
  const account = await currentAccount();
  if (!account) redirect("/login");

  const role = await resolveWorkspaceRole();
  if (!role) redirect("/login");
  if (role.side !== "lsg") redirect("/usg");

  return (
    <section className="mx-auto w-full max-w-2xl">
      <header className="border-b border-line/80 pb-4">
        <p className="eyebrow">Help</p>
        <h1 className="mt-1 text-[1.5rem] leading-tight sm:text-[1.75rem]">How this works</h1>
        <p className="mt-1 text-[0.9375rem] leading-relaxed text-body">
          Your unit submits and tracks. USG reads, decides, and posts.
        </p>
      </header>

      <ol className="mt-6 flex flex-col gap-5">
        {STEPS.map((step, index) => (
          <li key={step.title} className="border-l-2 border-line pl-4">
            <p className="text-[0.8125rem] text-muted">Step {index + 1}</p>
            <h2 className="mt-0.5 text-[1.0625rem] leading-snug">{step.title}</h2>
            <p className="mt-1 text-[0.9375rem] leading-relaxed text-body">{step.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-8 rounded-card border border-line bg-paper px-4 py-5">
        <h2 className="text-[1rem] leading-snug">Contact USG</h2>
        <p className="mt-1 text-[0.9375rem] leading-relaxed text-body">
          Need an account change, a new officer, or access you have lost? Contact USG. Accounts and
          access are handled by USG, not from this workspace.
        </p>
      </div>
    </section>
  );
}