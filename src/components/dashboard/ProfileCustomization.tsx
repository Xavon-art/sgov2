"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Enter } from "@/components/fx/Presence";
import { SwapText } from "@/components/fx/SwapText";
import { TextField } from "@/components/ui/Field";
import { useDashboard } from "@/components/dashboard/dashboard-context";

const ACCENTS = ["#16324f", "#a8822f", "#2f6b5f", "#6b3f6b", "#a5442c", "#1f4e79"];

export function ProfileCustomization() {
  const { account, meta } = useDashboard();
  const isOwner = account.accountScope === "owner";

  const [accent, setAccent] = useState(meta.accent || "#16324f");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [logoUrl, setLogoUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = (meta as { theme?: string }).theme === "dark" ? "dark" : "light";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(t);
    setLogoUrl((meta as { logoUrl?: string | null }).logoUrl ?? "");
    document.documentElement.classList.toggle("dark", t === "dark");
  }, [meta]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  if (!isOwner) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/org-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accent, theme, logoUrl: logoUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "We could not save your customization.");
        return;
      }
      try {
        localStorage.setItem("sgov-theme", theme);
      } catch {}
      setNote("Saved. Reload the page to apply.");
    } catch {
      setError("We could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="profile-customization" className="scroll-mt-24 mt-6">
      <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
        <p className="eyebrow">Profile & customization</p>
        <form onSubmit={save} className="mt-5 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-[0.8125rem] font-semibold text-ink">Accent color</label>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAccent(c)}
                  aria-label={c}
                  className={`h-8 w-8 rounded-full border-2 ${accent === c ? "border-ink" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="h-8 w-8 cursor-pointer rounded-full border border-line"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[0.8125rem] font-semibold text-ink">Theme</label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as "light" | "dark")}
              className="h-12 w-full rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <TextField
            id="logo-url"
            label="Logo URL (optional)"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://…/logo.png"
          />

          {error ? (
            <Enter open as="p" role="alert" className="rounded-xl border border-[#d9a99c] bg-[#a5442c]/[0.06] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#a5442c]">
              {error}
            </Enter>
          ) : null}
          {note ? (
            <Enter open as="p" role="status" className="rounded-xl border border-brass/40 bg-brass-soft/25 px-3.5 py-2.5 text-[0.8125rem] font-medium text-ink">
              {note}
            </Enter>
          ) : null}

          <Button type="submit" disabled={busy}>
            <SwapText isPending={busy} idle="Save customization" pending="Saving…" />
          </Button>
        </form>
      </div>
    </section>
  );
}