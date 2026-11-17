"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconLock } from "@/components/ui/Icons";

export function SignOutButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
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
    <>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        <IconLock className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        Sign out
      </Button>

      <ConfirmDialog
        open={confirming}
        busy={busy}
        title="Sign out of SmartGov?"
        description="Your workspace stays exactly as you left it. You will need your email and password to get back in."
        confirmLabel={busy ? "Signing out…" : "Sign out"}
        cancelLabel="Stay signed in"
        onConfirm={signOut}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}