"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Reveal } from "@/components/fx/Reveal";

export type OfficerProfile = {
  fullName: string;
  campusDepartment: string;
  program: string;
  position: string;
};

type ApiResponse = {
  ok?: boolean;
  profile?: OfficerProfile;
  reason?: string;
  message?: string;
};

const EMPTY: OfficerProfile = {
  fullName: "",
  campusDepartment: "",
  program: "",
  position: "",
};

export function OfficerProfileFields() {
  const [profile, setProfile] = useState<OfficerProfile>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/officer", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as ApiResponse;
      if (res.ok && body.ok && body.profile) {
        setProfile(body.profile);
      }
    } catch {
      setNote({ kind: "error", text: "We could not load your profile fields." });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/profile/officer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const body = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !body.ok) {
        setNote({
          kind: "error",
          text: body.message ?? "We could not save those fields.",
        });
        return;
      }
      if (body.profile) setProfile(body.profile);
      setNote({ kind: "ok", text: "Profile fields saved." });
    } catch {
      setNote({ kind: "error", text: "We could not save those fields." });
    } finally {
      setBusy(false);
    }
  }

  function update(key: keyof OfficerProfile, value: string) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  return (
    <Reveal className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="officer-full-name"
          label="Full name"
          value={profile.fullName}
          maxLength={200}
          onChange={(event) => update("fullName", event.target.value)}
        />
        <TextField
          id="officer-campus-department"
          label="Campus / department"
          value={profile.campusDepartment}
          maxLength={200}
          onChange={(event) => update("campusDepartment", event.target.value)}
        />
        <TextField
          id="officer-program"
          label="Program"
          value={profile.program}
          maxLength={200}
          onChange={(event) => update("program", event.target.value)}
        />
        <TextField
          id="officer-position"
          label="Position"
          value={profile.position}
          maxLength={200}
          onChange={(event) => update("position", event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save profile fields"}
        </Button>
        {note ? (
          <p
            role={note.kind === "error" ? "alert" : "status"}
            className={`text-[0.8125rem] ${note.kind === "error" ? "text-[#a5442c]" : "text-[#2f5d38]"}`}
          >
            {note.text}
          </p>
        ) : null}
      </div>
    </Reveal>
  );
}
