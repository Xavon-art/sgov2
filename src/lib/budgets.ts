/**
 * The vocabulary both budget screens share.
 *
 * Money is a string everywhere on the wire. `numeric` comes back from Postgres as
 * JSON numbers, and a float cannot be trusted to render `4501.5` as `4,501.50`
 * without help. Formatting once, here, keeps the LSG form and the USG review
 * column from disagreeing about what the same request costs.
 *
 * The statuses are the four the SQL accepts. There is no `draft` and no
 * `published`: a budget is submitted whole or not at all, and it stops at
 * approved or rejected.
 */
export type BudgetStatus = "submitted" | "returned" | "approved" | "rejected";

export type BudgetItem = {
  id: string;
  label: string;
  quantity: number;
  unitCost: number;
  subtotal: number;
};

export type BudgetRow = {
  id: string;
  proposalId: string | null;
  proposalTitle: string | null;
  eventId: string | null;
  eventTitle: string | null;
  eventDate: string | null;
  title: string;
  status: BudgetStatus;
  unitId: string | null;
  unitName: string | null;
  requestedTotal: number;
  approvedTotal: number | null;
  decisionRemark: string | null;
  itemCount: number;
  createdAt: string;
};

export type BudgetDetail = {
  id: string;
  proposalId: string | null;
  eventId: string | null;
  eventTitle: string | null;
  eventDate: string | null;
  title: string;
  justification: string | null;
  status: BudgetStatus;
  unitId: string | null;
  unitName: string | null;
  requestedTotal: number;
  approvedTotal: number | null;
  decisionRemark: string | null;
  decidedAt: string | null;
  createdAt: string;
  items: BudgetItem[];
};

export type BudgetUnitSummary = {
  unitId: string | null;
  unitName: string;
  requested: number;
  approved: number;
  remaining: number;
  openCount: number;
};

export type BudgetSummary = {
  units: BudgetUnitSummary[];
  totals: { requested: number; approved: number; remaining: number };
};

/** What the LSG types before anything is sent. Subtotals are never sent. */
export type DraftItem = { label: string; quantity: string; unitCost: string };

export const STATUS_LABEL: Record<BudgetStatus, string> = {
  submitted: "Awaiting review",
  returned: "Returned for revision",
  approved: "Approved",
  rejected: "Not approved",
};

export const STATUS_CLASS: Record<BudgetStatus, string> = {
  submitted: "border-line bg-canvas text-muted",
  returned: "border-brass/40 bg-brass-soft/30 text-brass-deep",
  approved: "border-ink/20 bg-ink/[0.06] text-ink",
  rejected: "border-[#d9a99c] bg-[#a5442c]/[0.08] text-[#a5442c]",
};

/** Only USG may approve, return or reject; only USG may see the summary. */
export type BudgetDecision = "approved" | "returned" | "rejected";

export function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Turns one typed row into what the RPC expects, or explains why it cannot.
 *
 * The client-side rules mirror `budget_write_items` on purpose: an officer on a
 * phone should learn that a quantity is unusable before a round trip, not after.
 * The SQL still decides -- this only decides whether to bother asking.
 */
export function toDraftPayload(
  items: DraftItem[],
): { ok: true; items: { label: string; quantity: number; unit_cost: number }[] } | { ok: false; message: string } {
  const cleaned = items.map((row) => ({
    label: row.label.trim(),
    quantity: parseAmount(row.quantity),
    unitCost: parseAmount(row.unitCost),
  }));

  if (cleaned.length === 0) {
    return { ok: false, message: "Add at least one line before sending." };
  }
  if (cleaned.length > 50) {
    return { ok: false, message: "A request can hold at most 50 lines." };
  }

  for (const row of cleaned) {
    if (!row.label) return { ok: false, message: "Every line needs a name." };
    if (row.quantity === null || row.quantity <= 0) {
      return { ok: false, message: `"${row.label}" needs a quantity above zero.` };
    }
    if (row.unitCost === null || row.unitCost < 0) {
      return { ok: false, message: `"${row.label}" needs a unit cost of zero or more.` };
    }
  }

  return {
    ok: true,
    items: cleaned.map((row) => ({
      label: row.label,
      quantity: row.quantity as number,
      unit_cost: row.unitCost as number,
    })),
  };
}