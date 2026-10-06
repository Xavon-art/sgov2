# Decision Log

Each entry is a choice that a reasonable person could have made differently, what was chosen,
and what would have gone wrong otherwise. Newest last.

The two standing rules this repo inherits are not repeated here: scope is enforced in the
database and never trusted from the client, and there are no RLS policies — scope lives in
`security definer` functions under `smartgov`, reached through `public` forwarders.
`scripts/check-units.mjs` fails the build if a `create policy` ever appears.

---

## Structure

### The structure is one JSON column, not rows

Chosen: `gov_structures.document jsonb`, validated as a whole by `gov_document_valid`.

A council's structure is read, written and reviewed as a whole. Row-per-committee would make
every keystroke-batch a transaction across two child tables and would make "is this valid?" a
question about a partially-applied write.

The cost is that JSONB does not promise key order on the way out, so **every read path must
build `{ committees: [...] }` in document order explicitly**. A contributor who reads it back
with a bare `jsonb_each` will silently produce a structure in the wrong order. This is guarded.

### `isUnit` is legal only on the first committee

Chosen: the validator rejects `isUnit` anywhere but index 0.

The first committee *is* the council and its seats belong to the unit. Letting a committee
anywhere in the list claim `isUnit` would make "whose seats are these?" a question about array
position. The builder therefore locks the council in place and never offers the flag elsewhere.

### Order is published, so it is not cosmetic

Chosen: committee order and position order are part of the document and are part of what a
reviewer approves.

The alternative — treating rows as a set — would mean a reordering is invisible to review, so a
reviewer approves "President, VP" without knowing whether it is about to become "VP, President".

### Keys are generated once and never recycled

Chosen: `nextKey()` mints `cmt-`/`pos-` keys from the clock plus randomness, and a deleted row's
key is not reused.

A recycled key would let a committee be deleted and recreated into the identity a decision
history already refers to, quietly merging two histories.

### `crypto.randomUUID` is not used for keys

Chosen: a clock-seeded counter with a random suffix.

`crypto.randomUUID` is unavailable on `http:` origins, and the app is served over plain http on
a LAN address in development. A key only has to be unique within one document, so this is
enough; the prefix keeps it clear of anything hand-typed in from a template.

### Photos are stripped on every read, not just some

Chosen: every function that returns a structure removes `holder.photo`; the document keeps
`hasPhoto`; bytes live in a large object behind its own scope-checked route.

A `hasPhoto` flag with a `photo` field on the same object is a leak waiting for one function
that forgets. Doing the stripping in SQL, on the way out, means a new read path is safe by
default. The cost is that an editor holds the bytes while it works — unavoidable, and bounded by
the 524,288-byte limit.

### `match_structure_holder` matches across the organization

Chosen: org-wide, not unit-scoped.

A person holding a seat in two colleges is one person with one photo. Scoping the lookup to the
unit would show "no photo on file" on one council's page for an officer whose face is already
on the other. `list_structure_roster` and the photo read stay unit-scoped — the wider lookup is
only for finding an id to fetch.

### Templates are holder-free and validated as such

Chosen: builtin seeding and `import_structure_template` both validate with
`p_allow_holders => false`; `list_structure_templates` returns the document only because that
invariant holds (migration `03030`).

The alternative — sanitizing on read — would mean the gallery could return a document that the
save path would then reject. Refusing to store a name in a shared template at all is the only
version where the two agree.

### A root structure auto-approves; an LSG structure does not

Chosen: `submit_structure` approves immediately when the unit is the organization root.

The USG top tier has nobody above it to review it, so a review queue for it would be a queue
that can never be drained. Everything below it goes to a reviewer.

### Self-review is refused

Chosen: `review_structure` rejects a reviewer whose account is the author.

It is the one approval rule with no legitimate exception, and an end-to-end test of approval
cannot use the officer who wrote the document. The browser probe creates two accounts for this
reason alone.

### Renewal carries forward; it does not rebuild

Chosen: `request_structure_renewal` seeds the new draft from the live structure and links it via
`renews_id`, defaulting the term to the day after the live one ends for a year.

Rebuilding from memory is the failure mode this feature exists to prevent — the whole reason a
council publishes its structure is so the next one has something to carry forward. A lapsed term
renews forward from its end date, which is exactly the council that most needs to renew.

Renewal is refused when something is already in flight, because otherwise the button would
create a second draft and the one-open-per-unit index would report `invalid_request` after the
click rather than before it.

### The drag handle is `aria-hidden`

Chosen: no role and no accessible name on the grip; the up/down buttons carry the names.

Dragging cannot be done from a keyboard. Giving the grip a button role announces a control that
does nothing when activated, which is worse than not announcing it. Reordering stays fully
accessible through the buttons, which name the row: "Move President up", not "up".

Both paths go through `useReorder`, so a pointer drag and a keyboard nudge cannot produce
different results.

---

## Housekeeping

### `lsg-nav.ts` keeps five items

Chosen: the structure builder is reached from the dashboard footer, not from the sidebar.

The sidebar is five items because an invited officer opens this on a phone between classes.
Adding a sixth item to reach something an officer uses a few times a year makes the common
screen worse for everyone. Not adding it also means no USG route string can reach the LSG
bundle.

### `/my-council` has a fixed pair of links at the bottom

Chosen: "Back to dashboard" and "Council structure".

The structure builder's "Back to council" lands here, and this page has no app nav of its own.
Without them it is a dead end, and an officer has to edit the URL to get out. Found by the
browser probe, not by reading the page.

### The browser probe runs against `next start`

Chosen: `npm run build && npm run probe:structure:browser`, defaulting to port 3100.

`next dev` compiles routes on demand, so the first click of a walkthrough can land before
hydration and submit the form natively to `/login?` — which looks like a sign-in bug and is not
one. A production build is also closer to what is deployed.

### Stop the server before rebuilding

Chosen as a rule after being learned the hard way.

A `next start` server holds its build manifest in memory. Rebuilding under it leaves it serving
references to chunks that the new build renamed, and the symptom is a chunk refused for its MIME
type — a message about static assets that has nothing to do with static assets. The process
command line is `next" start`, with a quote, so matching it needs to account for that.