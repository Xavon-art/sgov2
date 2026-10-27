"use client";

import { useEffect, useState } from "react";
import { SurveyDetailEditor } from "@/components/dashboard/SurveyDetailEditor";

export const dynamic = "force-dynamic";

export default function UsgSurveyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    void params.then((p) => setId(p.id));
  }, [params]);
  if (!id) return <p className="text-[0.9375rem] text-muted">Loading…</p>;
  return <SurveyDetailEditor id={id} isUsg />;
}