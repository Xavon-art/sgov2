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
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        router.push("/login");
        router.refresh();
        return;
      }
      setError("We could not sign out. Please try again.");
    } catch {
      setError("We could not sign out. Please try again.");
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
        description={
          <>
            Your workspace stays exactly as you left it. You will need your email and password to get back in.
            {error ? (
              <p role="alert" className="mt-3 text-sm font-medium text-[#a5442c]">
                {error}
              </p>
            ) : null}
          </>
        }
        confirmLabel={busy ? "Signing out…" : "Sign out"}
        cancelLabel="Stay signed in"
        onConfirm={signOut}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}