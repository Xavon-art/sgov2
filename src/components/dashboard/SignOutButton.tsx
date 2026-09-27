"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={signOut} disabled={busy}>
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
