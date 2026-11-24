"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SessionGuard } from "@/components/dashboard/SessionGuard";
import { Button } from "@/components/ui/Button";
import { ChartViewer } from "@/components/structure/ChartViewer";
import {
  NEUST_SAMPLES,
  cloneSampleDocument,
} from "@/components/structure/StructureWorkspace";
import {
  STRUCTURE_FORMAT_LABELS,
  structureFormat,
  type StructureFormat,
  type StructureScope,
} from "@/lib/structure";

type PreviewSearch = Promise<{
  template?: string | string[];
  unitId?: string | string[];
  scope?: string | string[];
  format?: string | string[];
  returnTo?: string | string[];
}>;

function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function scopeOf(value: string | string[] | undefined): StructureScope | null {
  const candidate = one(value);
  return candidate === "usg" || candidate === "lsg" ? candidate : null;
}

function formatOf(value: string | string[] | undefined): StructureFormat | null {
  const candidate = one(value);
  return candidate === "usg" || candidate === "lsg" || candidate === "campus" ||
    candidate === "college" || candidate === "department"
    ? candidate
    : null;
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
  const requestedScope = scopeOf(params.scope);
  const requestedFormat = formatOf(params.format);
  const unitId = one(params.unitId);
  const returnTo = safeReturn(params.returnTo);
  const [resolvedScope, setResolvedScope] = useState<StructureScope | null>(null);
  const [resolvedFormat, setResolvedFormat] = useState<StructureFormat | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The URL comes from the gallery, but it is still user-controlled. Ask the
  // server which council this session actually edits before allowing an apply.
  useEffect(() => {
    if (!unitId) {
      setScopeError("Open this preview from the structure editor, then apply the template.");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/structures?view=own");
        const payload = (await res.json()) as {
          ok?: boolean;
          unit?: { unitType?: string; isRoot?: boolean } | null;
        };
        if (cancelled) return;
        const nextFormat = structureFormat(payload.unit ?? {});
        const nextScope: StructureScope = nextFormat === "usg" ? "usg" : "lsg";
        if (!res.ok || !payload.ok || !payload.unit) {
          setScopeError("We could not confirm which council this preview belongs to.");
          return;
        }
        setResolvedScope(nextScope);
        setResolvedFormat(nextFormat);
        if (requestedScope && requestedScope !== nextScope) {
          setScopeError(
            `This sample is for ${requestedScope.toUpperCase()} only. You are editing a ${nextScope.toUpperCase()} structure.`,
          );
        }
      } catch {
        if (!cancelled) setScopeError("We could not reach the server. Try the preview again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unitId, requestedScope]);

  const sample = useMemo(() => {
    const scope = resolvedScope ?? requestedScope;
    const candidates = scope
      ? NEUST_SAMPLES.filter((entry) => entry.scope === scope)
      : NEUST_SAMPLES;
    return candidates.find((entry) => entry.key === templateKey) ?? candidates[0] ?? NEUST_SAMPLES[0];
  }, [templateKey, requestedScope, resolvedScope]);

  const wrongTemplate = Boolean(
    templateKey && resolvedScope && !NEUST_SAMPLES.some(
      (entry) => entry.key === templateKey && entry.scope === resolvedScope,
    ),
  );
  const canApply = Boolean(
    unitId && resolvedScope && resolvedFormat && !scopeError && !wrongTemplate && sample.scope === resolvedScope,
  );
  const doc = useMemo(() => cloneSampleDocument(sample), [sample]);

  function applyTemplate() {
    if (!unitId) {
      setError("Open this preview from the structure editor, then apply the template.");
      return;
    }
    if (!canApply || !resolvedScope || !resolvedFormat) {
      setError(scopeError ?? "This sample does not belong to the structure you are editing.");
      return;
    }
    try {
      localStorage.setItem(
        `smartgov:pending-template:${unitId}`,
        JSON.stringify({
          templateKey: sample.key,
          scope: resolvedScope,
          format: resolvedFormat,
          document: doc,
          appliedAt: Date.now(),
        }),
      );
      router.push(returnTo);
    } catch {
      setError("This browser could not save the applied template. Try again.");
    }
  }

  const visibleError = error ?? scopeError ?? (wrongTemplate ? "This sample is for the other council. Open the sample from your own structure editor." : null);
  const scopeLabel = sample.scope === "lsg" ? "LSG" : "USG";
  const formatLabel = STRUCTURE_FORMAT_LABELS[sample.format ?? resolvedFormat ?? "lsg"];

  return (
    <SessionGuard>
      <main data-tour="structure-preview" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="eyebrow">Full structure preview</p>
            <h1 className="mt-2 text-[1.875rem] leading-tight sm:text-[2.25rem]">{sample.name}</h1>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-body">
              {scopeLabel} positions only &middot; {formatLabel} format. Preview-only view. Use the
              template to open it in the full structure editor, where you can edit seats, add
              branches, upload photos, and save it as this unit&rsquo;s own government structure.
              Names and NEUST emails are samples — replace them before saving or submitting.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="paper" onClick={() => router.push(returnTo)}>
              Back to editor
            </Button>
            <Button type="button" onClick={applyTemplate} disabled={!canApply}>
              Use this template
            </Button>
          </div>
        </div>

        {visibleError ? (
          <p className="mt-5 rounded-xl border border-[#a33a2e]/35 bg-[#a33a2e]/[0.07] px-4 py-3 text-[0.875rem] text-[#8c3126]">
            {visibleError}
          </p>
        ) : null}

        <section className="mt-8 rounded-2xl border border-line bg-paper/70 p-4 sm:p-6">
          <ChartViewer
            doc={doc}
            title={sample.name}
            subtitle={`${scopeLabel} · ${formatLabel} sample preview — editable only after you use this template`}
            filename={`${sample.key}-preview`}
            maxHeight={780}
          />
        </section>

        <div className="mt-8 flex flex-wrap gap-3 border-t border-line pt-6">
          <Button type="button" variant="paper" onClick={() => router.push(returnTo)}>
            Back to editor
          </Button>
          <Button type="button" onClick={applyTemplate} disabled={!canApply}>
            Use this template
          </Button>
        </div>
      </main>
    </SessionGuard>
  );
}
