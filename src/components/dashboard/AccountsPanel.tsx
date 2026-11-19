"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Reveal } from "@/components/fx/Reveal";
import { cn } from "@/lib/utils";

type OrgAccount = {
  id: string;
  email: string;
  displayName: string | null;
  accountKind: string;
  accountScope: string;
};

type OfficerRow = {
  accountId: string;
  fullName: string;
  campusDepartment: string;
  program: string;
  position: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
};

type Row = OfficerRow & {
  accountKind: string;
};

export function AccountsPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const [accountRes, profileRes] = await Promise.all([
        fetch("/api/org-accounts", { cache: "no-store" }),
        fetch("/api/profile/officer?scope=all", { cache: "no-store" }),
      ]);
      const accountBody = (await accountRes.json().catch(() => ({}))) as {
        ok?: boolean;
        accounts?: OrgAccount[];
        message?: string;
      };
      const profileBody = (await profileRes.json().catch(() => ({}))) as {
        ok?: boolean;
        rows?: OfficerRow[];
        message?: string;
      };

      if (!accountRes.ok || !accountBody.ok || !profileRes.ok || !profileBody.ok) {
        setError(
          profileBody.message ?? accountBody.message ?? "We could not load the account roster.",
        );
        return;
      }

      const accounts = accountBody.accounts ?? [];
      const profiles = new Map((profileBody.rows ?? []).map((row) => [row.accountId, row]));
      const merged = accounts
        .filter((account) => account.accountScope === "invited")
        .map((account) => {
          const profile = profiles.get(account.id);
          return {
            accountId: account.id,
            fullName: profile?.fullName ?? account.displayName ?? "",
            campusDepartment: profile?.campusDepartment ?? "",
            program: profile?.program ?? "",
            position: profile?.position ?? "",
            email: profile?.email ?? account.email,
            displayName: profile?.displayName ?? account.displayName ?? "",
            role: profile?.role ?? account.accountScope,
            status: profile?.status ?? "active",
            accountKind: account.accountKind,
          };
        });
      setRows(merged);
      setError(null);
    } catch {
      setError("We could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function deactivate(id: string) {
    setBusyId(id);
    setNote(null);
    try {
      const res = await fetch(`/api/officers/${id}/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!res.ok || !body.ok) {
        setNote(body.message ?? "We could not deactivate that officer.");
        return;
      }
      setNote("Officer deactivated.");
      setDeactivatingId(null);
      setReason("");
      await load();
    } catch {
      setNote("We could not reach the server. Check your connection.");
    } finally {
      setBusyId(null);
    }
  }

  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [rows],
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-2.5" aria-live="polite">
        <div className="fade-in h-11 animate-pulse rounded-xl bg-ink/[0.05]" />
        <div className="fade-in h-11 animate-pulse rounded-xl bg-ink/[0.05]" style={{ animationDelay: "70ms" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-card border border-line bg-paper px-4 py-5">
        <p className="text-[0.9375rem] leading-relaxed text-body">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[0.9375rem] hover:bg-canvas"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <Reveal className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Federation roster</p>
          <h2 className="mt-1 text-[1.25rem] leading-tight">Accounts</h2>
          <p className="mt-1 text-[0.875rem] text-muted">
            Officer details, sign-in email, role and status. Email and role are shown only.
          </p>
        </div>
        <span className="text-[0.8125rem] text-muted">{sorted.length} officer(s)</span>
      </div>

      {note ? (
        <p role="status" className="text-[0.8125rem] text-[#2f5d38]">
          {note}
        </p>
      ) : null}

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-canvas/40 px-5 py-6 text-[0.9375rem] text-body">
          No officer accounts in this federation yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-paper/70">
          <table className="w-full min-w-[960px] text-left text-[0.875rem]">
            <thead>
              <tr className="border-b border-line/70 text-[0.75rem] uppercase tracking-[0.08em] text-muted">
                <th className="px-4 py-3 font-medium">Full name</th>
                <th className="px-4 py-3 font-medium">Campus / department</th>
                <th className="px-4 py-3 font-medium">Program</th>
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={row.accountId}
                  className={cn("border-b border-line/50 last:border-0", row.status !== "active" && "opacity-60")}
                >
                  <td className="px-4 py-3 align-top text-ink">{row.fullName || row.displayName || "—"}</td>
                  <td className="px-4 py-3 align-top text-body">{row.campusDepartment || "—"}</td>
                  <td className="px-4 py-3 align-top text-body">{row.program || "—"}</td>
                  <td className="px-4 py-3 align-top text-body">{row.position || "—"}</td>
                  <td className="px-4 py-3 align-top text-body">{row.email}</td>
                  <td className="px-4 py-3 align-top text-body">{row.role}</td>
                  <td className="px-4 py-3 align-top text-body">{row.status}</td>
                  <td className="px-4 py-3 align-top">
                    {deactivatingId === row.accountId ? (
                      <div className="flex flex-col gap-2">
                        <TextField
                          id={`deactivate-reason-${row.accountId}`}
                          label="Reason"
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          srLabel
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={busyId === row.accountId || row.status !== "active"}
                            onClick={() => void deactivate(row.accountId)}
                          >
                            Confirm deactivate
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setDeactivatingId(null);
                              setReason("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={row.status !== "active"}
                        onClick={() => setDeactivatingId(row.accountId)}
                      >
                        Deactivate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Reveal>
  );
}
