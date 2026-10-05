/**
 * Painted while a section route is being fetched.
 *
 * Sections are separate routes now, so switching sections costs a server render
 * where scrolling an anchor used to cost nothing. This boundary is what keeps
 * that from reading as a stall: Next streams the shell immediately and swaps this
 * out when the payload lands, so the sidebar, the header, and the background stay
 * put and only the middle changes.
 *
 * Without it the whole `min-h-dvh` shell is replaced by a blank frame on every
 * click, which looks far slower than the round trip actually is. The skeleton
 * matches the section header shape so the swap does not shift the layout.
 */
export default function DashboardLoading() {
  return (
    <div className="fade-in" aria-live="polite" aria-busy="true">
      <div className="mb-5 flex items-end justify-between gap-4 border-b border-line/80 pb-4">
        <div className="flex flex-col gap-2">
          <div className="h-3 w-24 animate-pulse rounded-full bg-ink/[0.06]" />
          <div className="h-7 w-56 animate-pulse rounded-full bg-ink/[0.08]" />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-5 rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
          <div className="h-3 w-40 animate-pulse rounded-full bg-ink/[0.06]" />
          <div className="h-12 animate-pulse rounded-xl bg-ink/[0.05]" />
          <div className="h-12 animate-pulse rounded-xl bg-ink/[0.05]" />
          <div className="h-11 w-32 animate-pulse rounded-full bg-ink/[0.08]" />
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
          <div className="h-3 w-28 animate-pulse rounded-full bg-ink/[0.06]" />
          <div className="h-12 animate-pulse rounded-xl bg-ink/[0.05]" />
          <div className="h-12 animate-pulse rounded-xl bg-ink/[0.04]" />
        </div>
      </div>
    </div>
  );
}