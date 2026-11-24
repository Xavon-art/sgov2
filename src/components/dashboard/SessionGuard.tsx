"use client";

import type { ReactNode } from "react";

/**
 * Reload-safe session guard.
 *
 * This used to end the session whenever a gated document was loaded directly --
 * including an ordinary refresh -- because `isBooted()` lives only in tab JS
 * state. That made testing painful: every hard reload bounced the user back to
 * `/login` even though the server had already accepted the session cookie.
 *
 * Temporarily disabled so both USG and LSG accounts can refresh freely. The
 * server-side `currentAccount()` checks in the layouts still refuse requests
 * with an invalid or expired session; only the client-side reload logout is gone.
 */
export function SessionGuard({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
