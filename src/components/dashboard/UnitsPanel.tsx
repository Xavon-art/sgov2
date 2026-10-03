"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Enter } from "@/components/fx/Presence";
import { SwapText } from "@/components/fx/SwapText";
import { TextField } from "@/components/ui/Field";
import { IconCheck } from "@/components/ui/Icons";
import { UNIT_TYPE_OPTIONS, fetchUnits, selectClass } from "./workspace-shared";
import type { UnitOption } from "@/app/api/units/route";

/**
 * Campuses, colleges, and departments under this account.
 *
 * Its own route, and that is the whole point of the split: this used to share
 * one component with the invitations table, so opening the dashboard fetched
 * `/api/invites` even when the reader only ever looked at their campuses. On
 * its own route it fetches `/api/units` and nothing else, and the invitations
 * list is not downloaded, parsed, or rendered to find out it is not being shown.
 *
 * The campuses are listed as well as added. They were previously visible only as
 * options in the invitation dropdown, which meant a page titled "Campuses" could
 * not answer the only question it existed to answer.
 */
export function UnitsPanel() {
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [unitName, setUnitName] = useState("");
  const [newUnitType, setNewUnitType] = useState("campus");
  const [adding, setAdding] = useState(false);
  const [unitError, setUnitError] = useState<string | null>(null);
  const [unitAdded, setUnitAdded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const list = await fetchUnits();
      if (cancelled) return;
      setUnits(list);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function onAddUnit(event: React.FormEvent) {
    event.preventDefault();
    setUnitError(null);
    setUnitAdded(null);
    setAdding(true);

    try {
      const res = await fetch("/api/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: unitName, unitType: newUnitType }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setUnitError(data.message ?? "We could not add that campus or department.");
        return;
      }
      setUnitAdded(`Added ${data.name}. You can now invite someone into it.`);
      setUnitName("");
      setUnits(await fetchUnits());
    } catch {
      setUnitError("We could not reach the server. Check your connection and try again.");
    } finally {
      setAdding(false);
    }
  }

  const typeLabel = (value: string) =>
    UNIT_TYPE_OPTIONS.find((t) => t.value === value)?.label ?? value;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">Add a campus or department</p>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
          Create the campus, college, or department first — then you can invite an LSG officer
          into it.
        </p>

        <form onSubmit={onAddUnit} noValidate className="mt-6 flex flex-col gap-5">
          <TextField
            id="add-unit-name"
            label="Name"
            placeholder="College of Engineering"
            value={unitName}
            onChange={(e) => setUnitName(e.target.value)}
            required
          />

          <div className="flex flex-col gap-2">
            <label htmlFor="add-unit-type" className="text-[0.8125rem] font-semibold text-ink">
              Type
            </label>
            <select
              id="add-unit-type"
              value={newUnitType}
              onChange={(e) => setNewUnitType(e.target.value)}
              className={selectClass}
            >
              {UNIT_TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {unitError ? (
            <Enter
              open
              as="p"
              role="alert"
              className="rise-in rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]"
            >
              {unitError}
            </Enter>
          ) : null}

          {unitAdded ? (
            <Enter
              open
              as="p"
              role="status"
              className="rise-in flex items-center gap-2 rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink"
            >
              <IconCheck className="stamp-in h-4 w-4 shrink-0 text-brass-deep" strokeWidth={2.2} />
              {unitAdded}
            </Enter>
          ) : null}

          <Button type="submit" size="md" disabled={adding} className="w-full sm:w-auto">
            <SwapText
              isPending={adding}
              idle={`Add ${UNIT_TYPE_OPTIONS.find((t) => t.value === newUnitType)?.label ?? "campus"}`}
              pending="Adding…"
            />
          </Button>
        </form>
      </section>

      <section className="card-lift rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">On record</p>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
          Everyone you invite as an officer is placed into one of these.
        </p>

        {loading ? (
          <div className="mt-5 flex flex-col gap-2.5" aria-live="polite">
            <div className="fade-in h-12 animate-pulse rounded-xl bg-ink/[0.05]" />
            <div
              className="fade-in h-12 animate-pulse rounded-xl bg-ink/[0.05]"
              style={{ animationDelay: "70ms" }}
            />
            <div
              className="fade-in h-12 animate-pulse rounded-xl bg-ink/[0.04]"
              style={{ animationDelay: "140ms" }}
            />
          </div>
        ) : units.length === 0 ? (
          <p className="rise-in mt-5 rounded-xl border border-dashed border-line-strong bg-canvas/40 px-3.5 py-4 text-[0.8125rem] leading-relaxed text-muted">
            Nothing on record yet. Add the first one on the left — until then there is no unit to
            invite someone into.
          </p>
        ) : (
          <ul className="mt-5 flex flex-col gap-2">
            {units.map((unit, index) => (
              <li
                key={unit.id}
                className="row-in flex items-baseline justify-between gap-4 rounded-xl border border-line bg-paper px-3.5 py-3"
                style={{ animationDelay: `${Math.min(index * 40, 200)}ms` }}
              >
                <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink-deep">
                  {unit.name}
                </span>
                <span className="shrink-0 text-[0.75rem] tracking-[0.06em] text-muted uppercase">
                  {typeLabel(unit.unitType)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}