"use client";

import { useState, type FormEvent } from "react";
import type { ItemKind } from "@/lib/mockdashboard/types";
import type { FileInput } from "@/lib/mockdashboard/db";
import { Card } from "@/components/mockdashboard/card";
import { Button } from "@/components/mockdashboard/button";
import { Field, inputCls } from "@/components/mockdashboard/field";
import { KindChip } from "@/components/mockdashboard/kind-chip";

export function FileNew({
  council,
  email,
  onFile,
}: {
  council: string;
  email: string;
  onFile: (kind: ItemKind, input: FileInput) => void;
}) {
  const [kind, setKind] = useState<ItemKind>("proposal");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");
  const [attendees, setAttendees] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const detail: Record<string, unknown> = { description };
    if (kind === "event") {
      detail.date = date;
      detail.venue = venue;
      detail.plannedAttendees = Number(attendees) || 0;
      detail.budgetUse = "To be covered by the council allocation";
    }
    if (kind === "budget") {
      detail.amount = Number(amount) || 0;
      detail.spent = 0;
      detail.purpose = purpose;
      detail.unitName = "Council allocation";
    }
    onFile(kind, { title: title.trim(), filedBy: council, filedByEmail: email, detail });
    setDone(title.trim());
    setTitle(""); setDescription(""); setDate(""); setVenue(""); setAttendees(""); setAmount(""); setPurpose("");
  };

  return (
    <Card title="File new" subtitle={`Submits to the USG review inbox as ${council}`}>
      <div className="mb-4 flex items-center gap-2">
        {(["proposal", "event", "budget"] as ItemKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              kind === k ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {k === "proposal" ? "Proposal" : k === "event" ? "Event" : "Budget request"}
          </button>
        ))}
      </div>

      <form className="space-y-4" onSubmit={submit}>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <KindChip kind={kind} />
          <span>{kind === "proposal" ? "Board resolution / activity document" : kind === "event" ? "Activity being planned" : "Funding request"}</span>
        </div>

        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} required placeholder={kind === "event" ? "e.g. Bonfire Night 2026" : "e.g. Student Assembly Proposal"} />
        </Field>

        {kind === "proposal" && (
          <Field label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputCls} placeholder="What are you proposing and why?" />
          </Field>
        )}

        {kind === "event" && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Date">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} required />
              </Field>
              <Field label="Venue">
                <input value={venue} onChange={(e) => setVenue(e.target.value)} className={inputCls} placeholder="Gymnasium" />
              </Field>
              <Field label="Expected attendees">
                <input type="number" min={0} value={attendees} onChange={(e) => setAttendees(e.target.value)} className={inputCls} placeholder="300" />
              </Field>
            </div>
            <Field label="Briefing (description)">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} placeholder="Activities, budget origin, safety notes…" />
            </Field>
          </>
        )}

        {kind === "budget" && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Amount (₱)">
                <input type="number" min={0} step={100} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} placeholder="8000" required />
              </Field>
              <Field label="Purpose">
                <input value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputCls} placeholder="e.g. Workshop materials" />
              </Field>
            </div>
            <Field label="Details">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} placeholder="Itemized spending plan…" />
            </Field>
          </>
        )}

        <div className="flex items-center justify-between gap-3">
          {done && <p className="text-sm text-emerald-600">“{done}” filed — the USG can now review it.</p>}
          <div className="ml-auto">
            <Button type="submit" variant="emerald">Submit for review</Button>
          </div>
        </div>
      </form>
    </Card>
  );
}