"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SessionGuard } from "@/components/dashboard/SessionGuard";
import { Button } from "@/components/ui/Button";
import { ChartViewer } from "@/components/structure/ChartViewer";
import {
  NEUST_SAMPLES,
  cloneSampleDocument,
  findStructureTemplate,
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

function editorReturnTo(value: string, unitId: string | null): string {
  if (!unitId || /[?&]unitId=/.test(value)) return value;
  return `${value}${value.includes("?") ? "&" : "?"}unitId=${encodeURIComponent(unitId)}`;
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
  const returnTo = editorReturnTo(safeReturn(params.returnTo), unitId);
  const [resolvedScope, setResolvedScope] = useState<StructureScope | null>(null);
  const [resolvedFormat, setResolvedFormat] = useState<StructureFormat | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The URL comes from the gallery, but it is still user-controlled. Ask the
  // server for the target unit itself, not merely the caller's own unit, so a
  // USG owner can prepare a structure for any council beneath the umbrella.
  useEffect(() => {
    if (!unitId) {
      setScopeError("Open this preview from the structure editor, then apply the template.");
      return;
    }
    let cancelled = false;
    setCanEdit(false);
    void (async () => {
      try {
        const res = await fetch(`/api/structures/${encodeURIComponent(unitId)}`);
        const payload = (await res.json()) as {
          ok?: boolean;
          unit?: { unitType?: string; isRoot?: boolean; parentId?: string | null } | null;
          capability?: { canRead?: boolean; canEdit?: boolean } | null;
        };
        if (cancelled) return;
        if (!res.ok || !payload.ok || !payload.unit) {
          setScopeError("We could not confirm which council this preview belongs to.");
          return;
        }
        const nextFormat = structureFormat(payload.unit);
        const nextScope: StructureScope = nextFormat === "usg" ? "usg" : "lsg";
        const nextCanEdit = Boolean(payload.capability?.canEdit);
        setResolvedScope(nextScope);
        setResolvedFormat(nextFormat);
        setCanEdit(nextCanEdit);
        if (!nextCanEdit) {
          setScopeError("You can preview this council, but you do not have edit access to apply a template.");
        } else if (requestedScope && requestedScope !== nextScope) {
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
    const format = resolvedFormat ?? requestedFormat;
    const found = findStructureTemplate(templateKey, scope, format);
    if (found) return found;
    const candidates = scope
      ? NEUST_SAMPLES.filter((entry) => entry.scope === scope)
      : NEUST_SAMPLES;
    return candidates[0] ?? NEUST_SAMPLES[0];
  }, [templateKey, requestedScope, resolvedScope, requestedFormat, resolvedFormat]);

  const wrongTemplate = Boolean(
    templateKey &&
      resolvedScope &&
      !findStructureTemplate(templateKey, resolvedScope, resolvedFormat),
  );
  const canApply = Boolean(
    unitId && canEdit && resolvedScope && resolvedFormat && !scopeError && !wrongTemplate && sample.scope === resolvedScope,
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
          category: sample.category,
          document: doc,
          appliedAt: Date.now(),
        }),
      );
      router.push(returnTo);
    } catch {
      setError("This browser could not save the applied template. Try again.");
    }
  }

  const isCustom = sample.category === "Custom";
  const visibleError =
    error ??
    scopeError ??
    (wrongTemplate
      ? isCustom
        ? "That blank chart belongs to the other council. Open it from your own structure editor."
        : "This sample is for the other council. Open the sample from your own structure editor."
      : null);
  const scopeLabel = sample.scope === "lsg" ? "LSG" : "USG";
  const formatLabel = STRUCTURE_FORMAT_LABELS[sample.format ?? resolvedFormat ?? requestedFormat ?? "lsg"];

  return (
    <SessionGuard>
      <main data-tour="structure-preview" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="eyebrow">Full structure preview</p>
            <h1 className="mt-2 text-[1.875rem] leading-tight sm:text-[2.25rem]">{sample.name}</h1>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-body">
              {isCustom ? (
                <>
                  A blank {scopeLabel} chart in {formatLabel} format, with no officers preset. Use it
                  to open the full structure editor, where you can name the council, add seats and
                  branches, upload photos, and save it as this unit&rsquo;s own structure.
                </>
              ) : (
                <>
                  {scopeLabel} positions only &middot; {formatLabel} format. Preview-only view. Use the
                  template to open it in the full structure editor, where you can edit seats, add
                  branches, upload photos, and save it as this unit&rsquo;s own government structure.
                  Names and NEUST emails are samples — replace them before saving or submitting.
                </>
              )}
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
            subtitle={`${scopeLabel} · ${formatLabel} ${isCustom ? "blank" : "sample"} preview — editable only after you use this template`}
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
