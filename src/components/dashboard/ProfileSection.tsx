"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Reveal } from "@/components/fx/Reveal";
import { Button } from "@/components/ui/Button";
import { PasswordField, TextField } from "@/components/ui/Field";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { OfficerProfileFields } from "@/components/dashboard/OfficerProfileFields";

/**
 * Profile and dashboard customisation, shared by both workspaces.
 *
 * Four independent writes live here, each mapped one-for-one to a database
 * function: rename, change email, change password, and (owner only) the
 * organisation's look. They are grouped on one panel because they are one job --
 * "make this account mine" -- not because they share a transaction. Keeping them
 * separate is what lets a wrong password in the email form fail without
 * disturbing a display-name save the user made a second earlier.
 *
 * The customisation block is rendered only for an owner, but hiding it is not
 * the gate: `update_customisation` refuses a non-owner itself, so a hand-typed
 * call from an officer still fails at the database.
 */

type ProfilePayload = {
  ok: boolean;
  account?: {
    email: string;
    displayName: string;
    accountScope: string;
    campusName: string;
    universityName: string;
  };
  organization?: {
    name: string;
    accent: string;
    themeMode: string;
  } | null;
  canCustomise?: boolean;
};

const ACCENTS = [
  { value: "#16324f", label: "Ink" },
  { value: "#a8822f", label: "Brass" },
  { value: "#2f5d38", label: "Forest" },
  { value: "#7a2f3a", label: "Claret" },
  { value: "#3b3f8f", label: "Indigo" },
];

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match the system" },
];

function notice(value: { kind: "ok" | "error"; text: string } | null) {
  if (!value) return null;
  return (
    <p
      role={value.kind === "error" ? "alert" : "status"}
      className={`text-[0.8125rem] ${value.kind === "error" ? "text-[#a5442c]" : "text-[#2f5d38]"}`}
    >
      {value.text}
    </p>
  );
}

export function ProfileSection({ allowCustomisation }: { allowCustomisation: boolean }) {
  const { account } = useDashboard();
  const router = useRouter();

  const [profile, setProfile] = useState<ProfilePayload["account"] | null>(null);
  const [org, setOrg] = useState<ProfilePayload["organization"]>(null);
  const [canCustomise, setCanCustomise] = useState(false);

  const [displayName, setDisplayName] = useState(account.displayName);
  const [universityName, setUniversityName] = useState(account.universityName);
  const [campusName, setCampusName] = useState(account.campusName);
  const [email, setEmail] = useState(account.email);
  const [emailPassword, setEmailPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [accent, setAccent] = useState("#16324f");
  const [themeMode, setThemeMode] = useState("light");

  const [busy, setBusy] = useState<"name" | "identity" | "email" | "password" | "look" | null>(null);
  const [nameNote, setNameNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [identityNote, setIdentityNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [emailNote, setEmailNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [passNote, setPassNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [lookNote, setLookNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      const body = (await res.json().catch(() => ({}))) as ProfilePayload;
      if (res.ok && body.ok) {
        setProfile(body.account ?? null);
        setOrg(body.organization ?? null);
        setCanCustomise(Boolean(body.canCustomise));
        if (body.account?.displayName) setDisplayName(body.account.displayName);
        if (body.account?.universityName) setUniversityName(body.account.universityName);
        if (body.account?.campusName) setCampusName(body.account.campusName);
        if (body.account?.email) setEmail(body.account.email);
        if (body.organization?.accent) setAccent(body.organization.accent);
        if (body.organization?.themeMode) setThemeMode(body.organization.themeMode);
      }
    } catch {
      /* the fields keep the values the layout already resolved */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function post(action: string, payload: Record<string, unknown>) {
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    return { ...json, ok: res.ok && json.ok === true };
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setBusy("name");
    setNameNote(null);
    try {
      const body = await post("profile", { displayName });
      setNameNote(
        body.ok
          ? { kind: "ok", text: "Your name is saved." }
          : { kind: "error", text: body.message ?? "We could not save that." },
      );
    } catch {
      setNameNote({ kind: "error", text: "We could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  async function saveIdentity(e: React.FormEvent) {
    e.preventDefault();
    setBusy("identity");
    setIdentityNote(null);
    try {
      const body = await post("identity", { universityName, campusName });
      if (body.ok) {
        setIdentityNote({ kind: "ok", text: "Your university and campus are saved." });
        // The badge and the dashboard chrome come from the server layout, so a
        // save here has to refresh it rather than only this panel.
        router.refresh();
      } else {
        setIdentityNote({
          kind: "error",
          text: body.message ?? "We could not save that.",
        });
      }
    } catch {
      setIdentityNote({ kind: "error", text: "We could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy("email");
    setEmailNote(null);
    try {
      const body = await post("email", { email, password: emailPassword });
      if (body.ok) {
        setEmailPassword("");
        setEmailNote({ kind: "ok", text: "Your sign-in email is updated." });
      } else {
        setEmailNote({ kind: "error", text: body.message ?? "We could not change that." });
      }
    } catch {
      setEmailNote({ kind: "error", text: "We could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy("password");
    setPassNote(null);
    try {
      const body = await post("password", { currentPassword, newPassword });
      if (body.ok) {
        setCurrentPassword("");
        setNewPassword("");
        setPassNote({ kind: "ok", text: "Your password is changed." });
      } else {
        setPassNote({ kind: "error", text: body.message ?? "We could not change that." });
      }
    } catch {
      setPassNote({ kind: "error", text: "We could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  async function saveLook(e: React.FormEvent) {
    e.preventDefault();
    setBusy("look");
    setLookNote(null);
    try {
      const body = await post("customisation", { accent, themeMode });
      setLookNote(
        body.ok
          ? { kind: "ok", text: "Saved. The dashboard picks the look up next time it loads." }
          : { kind: "error", text: body.message ?? "We could not save that." },
      );
    } catch {
      setLookNote({ kind: "error", text: "We could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  const showCustomisation = allowCustomisation && canCustomise;

  return (
    <div data-tour="manage-profile" className="flex flex-col gap-6">
      <section id="profile" className="scroll-mt-24">
        <Reveal>
          <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
            <p className="eyebrow">Your profile</p>
            <h2 className="mt-1 text-[1.25rem] leading-tight">Name and sign-in</h2>

            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-[0.75rem] tracking-[0.08em] text-muted uppercase">Account</dt>
                <dd className="mt-0.5 text-[0.9375rem] text-ink">
                  {(profile?.email ?? account.email) || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[0.75rem] tracking-[0.08em] text-muted uppercase">Role</dt>
                <dd className="mt-0.5 text-[0.9375rem] text-ink">
                  {account.accountScope === "owner" ? "Account owner" : "Invited member"}
                </dd>
              </div>
              <div>
                <dt className="text-[0.75rem] tracking-[0.08em] text-muted uppercase">Unit</dt>
                <dd className="mt-0.5 text-[0.9375rem] text-ink">
                  {campusName || profile?.campusName || account.campusName || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[0.75rem] tracking-[0.08em] text-muted uppercase">University</dt>
                <dd className="mt-0.5 text-[0.9375rem] text-ink">
                  {universityName || profile?.universityName || account.universityName || "—"}
                </dd>
              </div>
            </dl>

            <form onSubmit={saveName} className="mt-6 flex flex-col gap-3">
              <TextField
                id="profile-name"
                label="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
              <div className="flex items-center gap-3">
                <Button type="submit" size="sm" disabled={busy === "name"}>
                  {busy === "name" ? "Saving…" : "Save name"}
                </Button>
                {notice(nameNote)}
              </div>
            </form>
          </div>
        </Reveal>
      </section>

      <section id="identity" className="scroll-mt-24">
        <Reveal delay={0.01}>
          <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
            <p className="eyebrow">Where you are</p>
            <h2 className="mt-1 text-[1.25rem] leading-tight">University and campus</h2>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
              These name the place this workspace belongs to. They are shown in the dashboard
              header and are yours to keep current; they do not rename the organisation.
            </p>
            <form onSubmit={saveIdentity} className="mt-5 flex flex-col gap-3">
              <TextField
                id="profile-university"
                label="University"
                value={universityName}
                onChange={(e) => setUniversityName(e.target.value)}
                autoComplete="organization"
              />
              <TextField
                id="profile-campus"
                label="Campus or college"
                value={campusName}
                onChange={(e) => setCampusName(e.target.value)}
                autoComplete="address-level2"
              />
              <div className="flex items-center gap-3">
                <Button type="submit" size="sm" disabled={busy === "identity"}>
                  {busy === "identity" ? "Saving…" : "Save location"}
                </Button>
                {notice(identityNote)}
              </div>
            </form>
          </div>
        </Reveal>
      </section>

      <section id="officer-profile" className="scroll-mt-24">
        <Reveal delay={0.02}>
          <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
            <p className="eyebrow">Officer details</p>
            <h2 className="mt-1 text-[1.25rem] leading-tight">Profile fields</h2>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
              These describe the officer behind the account. Your sign-in email and role are
              managed separately and cannot be changed here.
            </p>
            <div className="mt-5">
              <OfficerProfileFields />
            </div>
          </div>
        </Reveal>
      </section>

      <section id="credentials" className="scroll-mt-24">
        <Reveal delay={0.04}>
          <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
            <p className="eyebrow">Credentials</p>
            <h2 className="mt-1 text-[1.25rem] leading-tight">Email and password</h2>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
              Both changes ask for your current password, so a borrowed session cannot move the
              account somewhere you do not control.
            </p>

            <form onSubmit={saveEmail} className="mt-5 flex flex-col gap-3">
              <TextField
                id="profile-email"
                label="Sign-in email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              <PasswordField
                id="profile-email-password"
                label="Current password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                autoComplete="current-password"
              />
              <div className="flex items-center gap-3">
                <Button type="submit" size="sm" variant="outline" disabled={busy === "email"}>
                  {busy === "email" ? "Saving…" : "Change email"}
                </Button>
                {notice(emailNote)}
              </div>
            </form>

            <form onSubmit={savePassword} className="mt-7 flex flex-col gap-3 border-t border-line/70 pt-6">
              <PasswordField
                id="profile-current"
                label="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
              <PasswordField
                id="profile-new"
                label="New password"
                hint="At least 8 characters."
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              <div className="flex items-center gap-3">
                <Button type="submit" size="sm" variant="outline" disabled={busy === "password"}>
                  {busy === "password" ? "Saving…" : "Change password"}
                </Button>
                {notice(passNote)}
              </div>
            </form>
          </div>
        </Reveal>
      </section>

      {showCustomisation ? (
        <section id="look" className="scroll-mt-24">
          <Reveal delay={0.08}>
            <div className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
              <p className="eyebrow">Customisation</p>
              <h2 className="mt-1 text-[1.25rem] leading-tight">How the dashboard looks</h2>
              <p className="mt-2 text-[0.875rem] leading-relaxed text-body">
                One dashboard, one look. Whatever you choose here is what every officer in{" "}
                {org?.name || "your organisation"} sees.
              </p>

              <form onSubmit={saveLook} className="mt-5 flex flex-col gap-5">
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-[0.75rem] tracking-[0.08em] text-muted uppercase">
                    Accent colour
                  </legend>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {ACCENTS.map((a) => (
                      <button
                        key={a.value}
                        type="button"
                        onClick={() => setAccent(a.value)}
                        aria-label={a.label}
                        aria-pressed={accent.toLowerCase() === a.value.toLowerCase()}
                        className={`pressable size-9 rounded-full border-2 transition-transform ${
                          accent.toLowerCase() === a.value.toLowerCase()
                            ? "border-ink scale-105"
                            : "border-line-strong"
                        }`}
                        style={{ backgroundColor: a.value }}
                      />
                    ))}
                    <label className="ml-1 inline-flex items-center gap-2 text-[0.8125rem] text-muted">
                      Custom
                      <input
                        type="color"
                        value={accent}
                        onChange={(e) => setAccent(e.target.value)}
                        className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent"
                        aria-label="Custom accent colour"
                      />
                    </label>
                  </div>
                </fieldset>

                <fieldset className="flex flex-col gap-2">
                  <legend className="text-[0.75rem] tracking-[0.08em] text-muted uppercase">
                    Appearance
                  </legend>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {THEMES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setThemeMode(t.value)}
                        aria-pressed={themeMode === t.value}
                        className={`pressable rounded-full border px-3.5 py-2 text-[0.8125rem] font-medium transition-colors ${
                          themeMode === t.value
                            ? "border-ink bg-ink text-white"
                            : "border-line-strong text-ink hover:bg-ink/[0.035]"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="flex items-center gap-3">
                  <Button type="submit" size="sm" disabled={busy === "look"}>
                    {busy === "look" ? "Saving…" : "Save look"}
                  </Button>
                  {notice(lookNote)}
                </div>
              </form>
            </div>
          </Reveal>
        </section>
      ) : null}
    </div>
  );
}
