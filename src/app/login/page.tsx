"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { TextField } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not sign you in.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Sign in"
      title="Welcome back"
      lede="Use the email your student government registered for you."
      footer={
        <p className="text-[0.8125rem] text-muted">
          No account yet?{" "}
          <Link href="/create" className="font-medium text-ink underline underline-offset-4">
            Set up a student organization
          </Link>
          .
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@university.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error ? (
          <p
            role="alert"
            className="animate-float-in rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]"
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="mt-6 rounded-xl border border-line bg-paper/60 px-4 py-3">
        <p className="text-[0.75rem] leading-relaxed text-muted">
          Invited but not activated yet? Open the link from your invitation email to
          finish setting up your password.
        </p>
      </div>
    </AuthShell>
  );
}
