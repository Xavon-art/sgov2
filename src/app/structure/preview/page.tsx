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
  const doc = useMemo(() => cloneSampleDocument(sample), [sample]);
  const [error, setError] = useState<string | null>(null);

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
              Preview-only view. Use the template to open it in the full structure editor, where you
              can edit seats, add branches, upload photos, and save it as your government structure.
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
            subtitle="Sample preview — editable only after you use this template"
            filename={`${sample.key}-preview`}
            maxHeight={780}
          />
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
