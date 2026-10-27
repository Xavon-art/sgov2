import { callRpc } from "@/lib/auth/rpc";

/**
 * Lazy scheduler backstop.
 *
 * Every timed state is already computed on read, so nothing here is required
 * for correctness. What this adds is materialisation: the status flips,
 * notifications, and queued emails that a background job would otherwise own.
 *
 * It is throttled in-process so a burst of dashboard reads does not turn into a
 * burst of sweeps. On serverless each instance keeps its own clock; that is
 * fine because the sweep itself is idempotent.
 */
let lastRun = 0;
let inFlight: Promise<void> | null = null;

export function maybeSweep(): void {
  const now = Date.now();
  if (inFlight || now - lastRun < 60_000) return;
  lastRun = now;
  inFlight = (async () => {
    try {
      await callRpc("sweep", {});
    } catch {
      // A failed sweep must never break the read that triggered it.
    } finally {
      inFlight = null;
    }
  })();
}
