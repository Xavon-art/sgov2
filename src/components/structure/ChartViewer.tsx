"use client";

/**
 * Read-only chart with a viewer's own format controls.
 *
 * The author's layout is the default; a viewer may switch template and
 * direction for their own screen, and that choice is remembered locally. It is
 * never written back to the structure.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CHART_TEMPLATES,
  type StructureDocument,
  type StructureLayout,
} from "@/lib/structure";
import { normalizeLayout } from "@/components/structure/document";
import { computeChart } from "@/components/structure/chart";
import { ZoomableChart, useChartPhotos } from "@/components/structure/StructureChart";
import { chartToSvg, downloadPng, downloadSvg, printSvg } from "@/components/structure/chart-export";
import { Button } from "@/components/ui/Button";

const STORAGE_KEY = "smartgov.chart.view";

export function ChartViewer({
  doc,
  title,
  subtitle,
  filename = "structure",
  maxHeight = 640,
}: {
  doc: StructureDocument;
  title?: string;
  subtitle?: string;
  filename?: string;
  maxHeight?: number;
}) {
  const authored = useMemo(() => normalizeLayout(doc.layout), [doc.layout]);
  const [layout, setLayout] = useState<StructureLayout>(authored);
  const [ready, setReady] = useState(false);

  // Read the viewer's preference after paint so the server and first client
  // render agree; the timeout keeps the state update out of the effect body.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setReady(true);
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as Partial<StructureLayout>;
        setLayout((prev) => ({
          ...prev,
          template: saved.template ?? prev.template,
          orientation: saved.orientation ?? prev.orientation,
        }));
      } catch {
        // A corrupt preference is not worth a message; the authored layout stands.
      }
    }, 0);
    // The authored layout is intentionally read once: later edits to the
    // document should not fight the viewer's choice.
    return () => window.clearTimeout(id);
  }, []);

  function choose(next: Partial<StructureLayout>) {
    setLayout((prev) => {
      const merged = { ...prev, ...next };
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ template: merged.template, orientation: merged.orientation }),
        );
      } catch {
        // Storage can be disabled; the choice still applies for this screen.
      }
      return merged;
    });
  }

  const geometry = useMemo(() => computeChart(doc, layout), [doc, layout]);
  const photos = useChartPhotos(geometry.nodes, layout.showPhotos);

  function svg() {
    return chartToSvg({ geometry, layout, photos, title, subtitle });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select
            value={layout.template}
            onChange={(e) => choose({ template: e.target.value as StructureLayout["template"] })}
            className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.75rem] text-ink"
            aria-label="Chart format"
          >
            {CHART_TEMPLATES.map((template) => (
              <option key={template.key} value={template.key}>
                {template.label}
              </option>
            ))}
          </select>
          <select
            value={layout.orientation}
            onChange={(e) => choose({ orientation: e.target.value as StructureLayout["orientation"] })}
            className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[0.75rem] text-ink"
            aria-label="Chart direction"
          >
            <option value="vertical">Top down</option>
            <option value="horizontal">Left to right</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => downloadPng(svg(), `${filename}.png`)}>
            PNG
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => downloadSvg(svg(), `${filename}.svg`)}>
            SVG
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => printSvg(svg(), title ?? "Structure")}>
            Print
          </Button>
        </div>
      </div>

      {ready ? (
        <ZoomableChart
          geometry={geometry}
          layout={layout}
          photos={photos}
          maxHeight={maxHeight}
        />
      ) : (
        <div
          className="grid place-items-center rounded-2xl border border-line text-[0.8125rem] text-muted"
          style={{ height: Math.min(maxHeight, 360) }}
        >
          Preparing the chart…
        </div>
      )}
    </div>
  );
}
