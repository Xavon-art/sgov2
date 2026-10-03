/**
 * Per-tab "this document has been alive since sign-in" marker.
 *
 * Signing out on refresh looks like it should be a cookie setting, and it is
 * not one. A session cookie is still attached to every request after a reload --
 * that is the whole point of it -- so nothing about `maxAge` or persistence can
 * tell the server "this one is a reload". The server is asked for the same
 * headers either way.
 *
 * The one thing a reload does destroy is the JavaScript context. Module state
 * starts empty in a fresh document and survives every in-app navigation, which
 * is exactly the distinction wanted:
 *
 *   - `router.refresh()`      -> module state intact  -> stay signed in
 *   - client nav, dashboard
 *     to the org chart        -> module state intact  -> stay signed in
 *   - F5, new tab, pasted URL -> fresh context        -> sign out
 *
 * This matters concretely rather than in principle. `/org-chart` calls
 * `router.refresh()` every ten seconds from `ChartRefresher`, plus once after
 * every mutation. Any mechanism that misreads an in-place refresh as a page
 * load signs the user out on a timer.
 *
 * Two consequences worth stating outright:
 *
 * Opening the dashboard in a new tab signs out, and because the session is torn
 * down in Postgres it ends that tab's siblings too. There is no way to tell a
 * reload from a new tab; both are a cold JavaScript context, and only the
 * server can end a session.
 *
 * And the check is client-side, so the dashboard's own markup cannot be withheld
 * by it -- the page is already in the document by the time this runs. The guard
 * below substitutes a neutral placeholder for it on the first render instead,
 * so private content never paints for someone about to be redirected.
 *
 * Deliberately a plain module boolean rather than context or a store: it has one
 * writer and one reader, and a value that must survive client navigation but
 * not a reload has no meaningful place in React state.
 */
let booted = false;

/** Call once, immediately after a successful sign-in, before routing anywhere. */
export function markBooted(): void {
  booted = true;
}

/** False only in a document that was loaded fresh rather than navigated within. */
export function isBooted(): boolean {
  return booted;
}