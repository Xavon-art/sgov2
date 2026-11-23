"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Seal } from "@/components/ui/Seal";
import { markBooted } from "@/lib/auth/boot";

function Finishing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <Seal size={48} />
      <h1 className="text-[1.5rem] leading-tight">Finishing sign in</h1>
      <p className="text-[0.9375rem] leading-relaxed text-body">
        Taking you to your workspace.
      </p>
    </main>
  );
}

function Handoff() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }
    markBooted();
    router.replace("/usg");
    router.refresh();
  }, [router, token]);

  return <Finishing />;
}

export default function ActivateCompletePage() {
  return (
    <Suspense fallback={<Finishing />}>
      <Handoff />
    </Suspense>
  );
}
