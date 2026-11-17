import Link from "next/link";

/**
 * Shown when a section is reached by URL but the account cannot use it.
 *
 * The nav never links here for these accounts, so this is not a permissions
 * screen -- it is what stops a hand-typed or stale URL from rendering a form the
 * database will refuse. Same shape as the "could not load" state in the layout,
 * on purpose: both are "this address does not lead anywhere for you".
 */
export function NotAvailable() {
  return (
    <section data-tour="not-available" className="rise-in mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-[1.25rem] leading-tight">Not available on this account</h2>
      <p className="text-[0.9375rem] leading-relaxed text-body">
        This section belongs to the account owner. If you think that is wrong, ask whoever invited
        you to make you one.
      </p>
      <Link
        href="/dashboard"
        className="pressable mt-1 rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-medium text-ink hover:border-ink/40 hover:bg-ink/[0.035]"
      >
        Back to overview
      </Link>
    </section>
  );
}