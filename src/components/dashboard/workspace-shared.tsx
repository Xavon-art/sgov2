import type { InviteRow } from "@/app/api/invites/route";
import type { UnitOption } from "@/app/api/units/route";
import { IconCheck, IconClock } from "@/components/ui/Icons";

/**
 * Bits shared by the two owner panels.
 *
 * These lived inside the 782-line `Workspace` when units and invitations were
 * one component on one page. Splitting the page by section means each panel is
 * its own route with its own bundle, so anything both of them need has to move
 * out rather than be copied -- two copies of the status badge is how the two
 * halves start disagreeing about what "expired" looks like.
 */

/**
 * Row stagger ceiling. Rows are keyed by invitation id, so an existing row is
 * never remounted when a refetch returns and only genuinely new ones animate.
 * The cap is what stops a long table from taking a visible quarter second to
 * settle -- past a handful of rows the cascade stops reading as a sequence and
 * starts reading as lag.
 */
export const ROW_STAGGER_MS = 40;
export const ROW_STAGGER_CAP_MS = 200;

/** Types a campus, college, or department can be added as. */
export const UNIT_TYPE_OPTIONS = [
  { value: "campus", label: "Campus" },
  { value: "college", label: "College" },
  { value: "department", label: "Department" },
] as const;

/** Types the centralized office can record somebody against. */
export const UNIT_TYPES = [
  { value: "lsg", label: "Local Student Government" },
  { value: "college", label: "College" },
  { value: "campus", label: "Campus" },
  { value: "council", label: "Council" },
] as const;

export const selectClass =
  "h-12 w-full appearance-none rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep outline-none transition-[border-color,box-shadow,background-color] duration-300 hover:border-line-strong focus:border-ink/25 focus:bg-paper";

/**
 * `key={status}` is load-bearing. All three branches render a `span`, so without
 * it React reconciles a status change in place -- same element, new classes --
 * and a mount-time animation never fires. The status would then change with no
 * acknowledgement at all, which is the exact moment that most needs one.
 */
export function StatusBadge({ status }: { status: InviteRow["status"] }) {
  if (status === "activated") {
    return (
      <span
        key={status}
        className="pop-in inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-canvas uppercase"
      >
        <IconCheck className="h-3 w-3" strokeWidth={2.6} />
        Activated
      </span>
    );
  }

  if (status === "expired") {
    return (
      <span
        key={status}
        className="pop-in inline-flex items-center rounded-full border border-line px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-muted uppercase"
      >
        Expired
      </span>
    );
  }

  return (
    <span
      key={status}
      className="pop-in inline-flex items-center gap-1.5 rounded-full bg-brass-soft/45 px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-brass-deep uppercase"
    >
      <IconClock className="h-3 w-3" strokeWidth={2.4} />
      Pending
    </span>
  );
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The rows, or `null` when the read failed. A failure is deliberately not
 * reported as an empty list: after a cancel or a resend an empty list would
 * read as "no invitations at all" and blank a table that is still correct.
 */
export async function fetchInvites(): Promise<InviteRow[] | null> {
  try {
    const res = await fetch("/api/invites");
    const data = await res.json();
    if (res.ok && data.ok) return (data.invites ?? []) as InviteRow[];
  } catch {
    // Fall through to null so the caller keeps whatever it already has.
  }
  return null;
}

/**
 * Children only. The endpoint returns the root USG alongside the units, and the
 * root is the caller's own organization rather than something an officer is
 * invited into, so it never reaches the dropdown.
 */
export async function fetchUnits(): Promise<UnitOption[]> {
  try {
    const res = await fetch("/api/units");
    const data = await res.json();
    if (res.ok && data.ok) {
      return (data.units ?? []).filter((u: UnitOption) => u.id !== data.root?.id);
    }
  } catch {
    // Fall through to the empty list; each panel shows its own empty state.
  }
  return [];
}