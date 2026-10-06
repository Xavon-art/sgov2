# Design — Government Structure

Status: implemented. Written after the feature shipped, so it describes what is
actually built rather than what was planned.

## 1. What the feature is

An LSG officer writes their council's structure — the council, its committees, and the
positions in each with who holds them — and a USG officer reviews and approves it. The
approved structure is then what the seat model is rewritten from.

Two things make this different from ordinary CRUD:

1. **The document is ordered and the order is meaning.** Committee order and position order
   are published facts, not cosmetics.
2. **A structure is a person, and a person is regulated.** Every holder carries an email, a
   name, and optionally a photo. Those are the fields most likely to leak, so the shape of
   the read path was decided before the shape of the write path.

## 2. The document

```jsonc
{
  "committees": [
    {
      "key": "cmt-m8x1-9fq2",     // generated once, never reused
      "name": "College of Engineering Student Council",
      "isUnit": true,             // only legal on the first committee
      "description": null,        // optional
      "positions": [
        {
          "key": "pos-m8x1-7b31",
          "title": "President",
          "holder": {             // null means the seat is vacant
            "email": "…",
            "firstName": "…",
            "lastName": "…",
            "middleName": "…",
            "course": "…",
            "yearLevel": "…",
            "contactNumber": "…",
            "address": "…",
            "birthdate": "…",
            "hasPhoto": true,     // a flag, never the bytes
            "photo": "…"          // write-only; stripped on every read
          }
        }
      ]
    }
  ]
}
```

Two invariants are enforced twice, on purpose:

- **`key` is generated once and never recycled.** A committee that is deleted and recreated
  gets a new key, so it cannot inherit an identity that a decision history already used.
- **At most one committee carries `isUnit`, and only the first.** `gov_document_valid` refuses
  anything else, so the builder never offers it.

`gov_document_valid` is the authority. `src/components/structure/document.ts` re-implements
the same checks so the builder can point at the offending row while the person is still
looking at it; anything it misses is caught by the save.

## 3. Why the document is one JSON column

A council's structure is read as a whole, written as a whole, and reviewed as a whole. Row-per-
committee would make every edit a transaction across a child table and a position table, and
would make "is this valid?" a question about a partially-applied write.

The cost is that ordering must be stored explicitly, because JSONB does not promise key order
on the way back out. Every read path therefore emits `{ committees: [...] }` as an array built
in document order, not as a map iterated for its keys. `scripts/check-units.mjs` fails the
build if that ever regresses to object iteration.

## 4. Lifecycle

```
draft ──submit──▶ submitted ──approve──▶ approved (published)
  ▲                    │
  │                    ├──return──▶ returned ──resubmit──▶ submitted
  │                    │
  └──edit (any time)──┴──reject──▶ rejected
```

- A **root** structure (the USG top tier) auto-approves on submit: there is no one above it to
  review it. An LSG structure always goes to a reviewer.
- **Self-review is refused.** The reviewer must be a different person; the probe uses two
  accounts because a single one cannot exercise approval at all.
- `returned` is editable again and resubmits into the same structure, so the decision history
  stays on one row instead of fragmenting.

## 5. Renewal

Renewing is "carry this forward", not "rebuild it from memory". `request_structure_renewal`
seeds a new draft from the structure currently in force, links it with `renews_id`, and
defaults the new term to the day after the live one ends, for a year. A council whose term has
lapsed renews forward from its end date — that is exactly the council that needs to renew.

The carried-forward document includes photo bytes, which is the one place they persist: the
draft holds them until it is submitted, and approval rewrites the same roster rows matched by
email, so the photo survives.

Renewal is refused when nothing is live, and refused when something is already in flight —
otherwise the button would create a second draft and the one-open-per-unit index would turn
that into `invalid_request` at the last moment, which is a worse error to show somebody who
pressed a button that looked available.

## 6. People and photos

The read path never carries a photo.

- The document in `gov_structures.document` stores `hasPhoto` and, while an editor is working,
  `photo`.
- **Every** function that returns a structure strips `photo` on the way out, so no read of a
  structure puts every officer's face into a JSON payload.
- Bytes live in a PostgreSQL large object. The photo route is a separate, scope-checked
  request; `fetchMemberPhoto` returns a data URL for exactly one person at a time.
- Limit is 524,288 bytes, from `gov_document_valid`. The builder refuses a larger file while it
  is still local, before spending the upload.

`match_structure_holder` matches across the **organization**, not the unit. A person holding a
seat in two colleges is one person, and the photo should be found from either council's page.
`list_structure_roster` and the photo read stay unit-scoped.

## 7. Permissions

All of it is in SQL. No client sends a scope, and no client believes one.

| Check | Where |
| --- | --- |
| May this account read/edit this unit's structure | `gov_unit_access` |
| Is this a live reviewer seat | `smartgov.is_org_reviewer` |
| Is this the author's own draft | `author_id` / `account_scope` |
| May a reviewer decide this | `review_structure` |

`account_scope` is `owner` or `invited`; an invited LSG officer authors their own unit's
structure and cannot author another. The builder renders from the `capability` the database
returns — if the page disagrees with the database, the database wins, and a save attempted
without the editor is refused anyway.

## 8. Templates

A template is a holder-free skeleton. Both the builtin seeding and
`import_structure_template` validate with `p_allow_holders => false`, which refuses any named
person, and `list_structure_templates` returns the document only because that invariant holds
(migration `03030`).

The builder applies a template by keeping the template's own keys. Uniqueness is per document,
not per unit, so two councils using the same skeleton is fine.

## 9. Ordering in the UI

Ordering is a real edit, so it is reachable two ways: a drag handle for pointers, and explicit
up/down buttons for keyboards and touch. Both go through `useReorder`, so they cannot disagree.

The handle is `aria-hidden` on purpose. Dragging cannot be done from a keyboard, so giving it a
role and an accessible name would announce a control that does nothing when activated. The
buttons carry the names instead — "Move President up", not just "up".

The council (first committee) is locked in place, because `gov_document_valid` accepts `isUnit`
on that row and nowhere else; dragging a committee above it would silently change which
committee holds the unit's own seats.

## 10. Verification

| Layer | Script | Covers |
| --- | --- | --- |
| SQL | `scripts/probe-structure.mjs` | 111 checks: lifecycle, validation, permissions, renewal, photos |
| PostgREST | `scripts/probe-structure-http.mjs` | 58 checks: the real wire signatures through the forwarders |
| Contracts | `scripts/check-units.mjs` | 269 guards: schema, grants, RLS absence, ordering, source text |
| Browser | `scripts/probe-structure-browser.mjs` | 23 checks: real sign-in, builder, reorder, submit, review, approve, renew, session guard |

The browser probe builds its own organization and two officers, tears it down including on a
throw, and ends by proving the tab-tied `SessionGuard` still fires — a guard that does not is
worse than no guard.

Run it against a production build, not `next dev`:

```
npm run build && npm run probe:structure:browser
```

It defaults to `http://127.0.0.1:3100`; override with `PROBE_BASE_URL`. Two traps worth knowing,
both of which cost real time:

- A cold load is signed out. `SessionGuard` keys off a per-tab `markBooted()`, so every
  navigation in the walkthrough has to be a click, never a `goto`.
- Rebuilding while a `next start` server is running leaves that server serving a stale manifest
  against freshly written chunks, and the failure looks like a broken chunk MIME type rather than
  a build problem. Stop the server first.