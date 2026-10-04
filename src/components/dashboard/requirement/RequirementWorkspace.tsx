"use client";

import { useEffect, useState } from "react";
import type { Account } from "@/lib/auth/session";
import { UsgShell } from "./UsgShell";
import { LsgShell } from "./LsgShell";

/**
 * Chooses between the two governance workspaces.
 *
 * The owner runs the USG: a review inbox, the programs it publishes, and the
 * requirement templates those programs ask for. Everyone else gets the LSG view:
 * the published programs to draft against, and their own unit's proposals with
 * their status and the USG's remarks.
 *
 * The branch this came from also mounted the old combined `Workspace` here and
 * gated it behind a "set up your units first" screen. Both are gone. Units and
 * invitations are their own routes now (`/dashboard/units`,
 * `/dashboard/invitations`), so there is nothing left to gate, and a USG with no
 * units yet can still publish a program and a default template -- which is
 * exactly what it needs to do before the first LSG exists.
 */
export function RequirementWorkspace({ account }: { account: Account }) {
  const isOwner = account.accountScope === "owner";
  const [reviewer, setReviewer] = useState(false);

  // An invited officer who sits on the USG board reviews, so they get the USG
  // view too. Probed rather than assumed: board membership is a membership row
  // in a `usg` unit, not a column on the account, so the client cannot know it.
  // The answer is only ever used to choose which shell to render -- every read
  // and write behind them is re-proven server-side.
  useEffect(() => {
    if (isOwner) return;
    let alive = true;
    fetch("/api/reviewer")
      .then((r) => r.json())
      .then((d) => {
        if (alive && d.ok) setReviewer(Boolean(d.reviewer));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isOwner]);

  const showUsg = isOwner || reviewer;

  return showUsg ? <UsgShell /> : <LsgShell />;
}
