"use client";

import { Suspense, useEffect, useState } from "react";
import { SurveyPublicForm } from "@/components/forms/SurveyPublicForm";

export const dynamic = "force-dynamic";

export default function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    void params.then((p) => setId(p.id));
  }, [params]);
  if (!id) return null;
  return (
    <Suspense fallback={null}>
      <SurveyPublicForm id={id} />
    </Suspense>
  );
}
