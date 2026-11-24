"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SessionGuard } from "@/components/dashboard/SessionGuard";
import { Button } from "@/components/ui/Button";
import { ChartViewer } from "@/components/structure/ChartViewer";
import {
  NEUST_SAMPLES,
  cloneSampleDocument,
} from "@/components/structure/StructureWorkspace";
import { holderPhotoUrl } from "@/components/structure/chart";
import { initials } from "@/components/structure/StructureChart";
import { holderName } from "@/components/structure/document";
import { MAX_PHOTO_BYTES, type StructureDocument, type StructureHolder } from "@/lib/structure";

type PreviewSearch = Promise<{
  template?: string | string[];
  unitId?: string | string[];
  returnTo?: string | string[];
}>;

function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function safeReturn(value: string | string[] | undefined): string {
  const candidate = one(value);
  return candidate && candidate.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : "/usg/manage?tab=structure";
}

function patchHolder(
  doc: StructureDocument,
  positionKey: string,
  patch: Partial<StructureHolder>,
): StructureDocument {
  return {
    ...doc,
    committees: doc.committees.map((committee) => ({
      ...committee,
      positions: committee.positions.map((position) => {
        if (position.key !== positionKey) return position;
        const holder = position.holder ? { ...position.holder, ...patch } : position.holder;
        const holders = position.holders?.length
          ? position.holders.map((entry, index) => (index === 0 ? { ...entry, ...patch } : entry))
          : holder
            ? [holder]
            : position.holders;
        return { ...position, holder, holders };
      }),
    })),
  };
}

export default function StructureTemplatePreviewPage({
  searchParams,
}: {
  searchParams: PreviewSearch;
}) {
  const params = use(searchParams);
  const router = useRouter();
  const templateKey = one(params.template);
  const sample = NEUST_SAMPLES.find((entry) => entry.key === templateKey) ?? NEUST_SAMPLES[0];
  const unitId = one(params.unitId);
  const returnTo = safeReturn(params.returnTo);
  const [doc, setDoc] = useState<StructureDocument>(() => cloneSampleDocument(sample));
  const [error, setError] = useState<string | null>(null);

  const seats = useMemo(
    () =>
      doc.committees
        .flatMap((committee) =>
          committee.positions.map((position) => ({
            key: position.key,
            title: position.title,
            committee: committee.name,
            holder: position.holder ?? position.holders?.[0] ?? null,
          })),
        )
        .filter((seat): seat is { key: string; title: string; committee: string; holder: StructureHolder } =>
          Boolean(seat.holder),
        ),
    [doc],
  );

  async function uploadPhoto(positionKey: string, file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
      if (file.size > MAX_PHOTO_BYTES) throw new Error("Photos must be 512 KB or smaller.");
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of buffer) binary += String.fromCharCode(byte);
      setDoc((prev) => patchHolder(prev, positionKey, { photo: btoa(binary), hasPhoto: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That photo could not be added.");
    }
  }

  function removePhoto(positionKey: string) {
    setDoc((prev) => patchHolder(prev, positionKey, { photo: undefined, hasPhoto: false }));
  }

  function applyTemplate() {
    if (!unitId) {
      setError("Open this preview from the structure editor, then apply the template.");
      return;
    }
    try {
      localStorage.setItem(
        `smartgov:pending-template:${unitId}`,
        JSON.stringify({ templateKey: sample.key, document: doc, appliedAt: Date.now() }),
      );
      router.push(returnTo);
    } catch {
      setError("This browser could not save the applied template. Try again.");
    }
  }

  return (
    <SessionGuard>
      <main data-tour="structure-preview" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="eyebrow">Full structure preview</p>
            <h1 className="mt-2 text-[1.875rem] leading-tight sm:text-[2.25rem]">{sample.name}</h1>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-body">
              See the whole chart, add officer photos, then apply it to your live structure draft.
              Names and NEUST emails are samples — replace them before saving or submitting.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="paper" onClick={() => router.push(returnTo)}>
              Back to editor
            </Button>
            <Button type="button" onClick={applyTemplate} disabled={!unitId}>
              Use this template
            </Button>
          </div>
        </div>

        {error ? (
          <p className="mt-5 rounded-xl border border-[#a33a2e]/35 bg-[#a33a2e]/[0.07] px-4 py-3 text-[0.875rem] text-[#8c3126]">
            {error}
          </p>
        ) : null}

        <section className="mt-8 rounded-2xl border border-line bg-paper/70 p-4 sm:p-6">
          <ChartViewer
            doc={doc}
            title={sample.name}
            subtitle="Sample preview — replace names before saving"
            filename={`${sample.key}-preview`}
            maxHeight={780}
          />
        </section>

        <section className="mt-8">
          <div className="max-w-2xl">
            <p className="eyebrow">Officer photos</p>
            <h2 className="mt-1 text-[1.25rem] leading-tight">Add a face to each seat</h2>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
              Uploaded photos stay in this preview until you choose “Use this template”. If no photo
              is added, the chart shows the first letter of the officer&apos;s name.
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {seats.map((seat) => {
              const url = holderPhotoUrl(seat.holder.photo);
              const label = holderName(seat.holder) || seat.holder.email;
              return (
                <article key={seat.key} className="rounded-xl border border-line bg-paper/70 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-canvas text-[0.9375rem] font-semibold text-ink-soft">
                      {url ? (
                        // The bytes come from the local file the officer chose.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt="" className="size-full object-cover" />
                      ) : (
                        initials(label)
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[0.9375rem] font-medium text-ink-deep">{label}</p>
                      <p className="truncate text-[0.75rem] text-muted">
                        {seat.title} &middot; {seat.committee}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <label className="cursor-pointer rounded-lg border border-line bg-paper px-3 py-1.5 text-[0.75rem] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink">
                      {url ? "Change photo" : "Upload photo"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void uploadPhoto(seat.key, e.target.files?.[0])}
                      />
                    </label>
                    {url ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => removePhoto(seat.key)}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className="mt-8 flex flex-wrap gap-3 border-t border-line pt-6">
          <Button type="button" variant="paper" onClick={() => router.push(returnTo)}>
            Back to editor
          </Button>
          <Button type="button" onClick={applyTemplate} disabled={!unitId}>
            Use this template
          </Button>
        </div>
      </main>
    </SessionGuard>
  );
}
