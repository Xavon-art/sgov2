# Design — Requirement check (the "SmartGov is intelligent" claim, made concrete)

Status: implemented. Written after the feature shipped, so it describes what is actually
built rather than what was planned.

## 1. What the feature is

A reviewer (or the author) opens a proposal and presses **Run requirement check**. The
server reads every file attached to the latest version, extracts text from it, compares
what it finds against the organisation's own requirement items, and returns a fixed-schema
report: for each item — is the document present, readable, the right document, complete
enough to rule on, and does it say the things an item like this should say (a date, an
amount, the unit's name). Each finding carries a recommendation the reviewer can act on.

This is the concrete substance behind the claim that SmartGov is intelligent: the app
*reads the submitted paperwork* rather than only storing it.

### What the reviewer is told, exactly

The panel above the document checklist says:

> **Requirement check**
> Reads the submitted files and compares them with these requirement items — what is
> present, what is missing, and what looks inconsistent. An aid for your ruling, not the
> ruling itself.

and every report ends with the fixed disclaimer:

> This is a deterministic reading aid produced from the submitted bytes and the
> organization's own requirement items. It is not a decision; a reviewer still rules on
> each document.

## 2. Why there is no LLM behind it

Chosen: a deterministic in-process engine (plain TypeScript), no model API, no keys, no
per-check cost. See `docs/DECISIONS.md`.

Two properties fall out of that choice and are the reason it holds up:

1. **Free forever.** A check costs a few hundred milliseconds of server CPU. Nothing about
   the feature degrades when a free tier changes, and there is no secret to leak.
2. **The output cannot wander.** The report is a closed shape: `scope: "app"`, a closed
   `SignalCode` union, and recommendations drawn from fixed templates whose only
   interpolation is the name of another requirement item the app already holds. The
   engine has no channel through which it can opine on anything outside this
   organisation's requirements — the failure mode people fear from "AI reviewers"
   (confident nonsense about things it was never asked) is structurally impossible here.

"Intelligent" in the product sense is kept: the engine genuinely *reads* documents,
*classifies* them against requirement vocabulary, *extracts* facts, and *notices*
inconsistencies. What is given up is open-ended prose generation, which the reviewer did
not need anyway — a ruled-on remark box already exists for human judgement.

## 3. The pipeline

Five pure modules under `src/lib/compliance/`, no database access, no `server-only`, so
the same code runs in the route and under `npx tsx` in the probe.

| Module | Job |
| --- | --- |
| `textify.ts` | bytes → text. PDF via `pdfjs-dist`, DOCX via `mammoth`, XLSX via `read-excel-file/node`, TXT as-is; anything else returns an `issue` the signals understand. |
| `facts.ts` | Regex extraction of dates, amounts (₱/PHP/budget…), emails, reference numbers; substring-deduped so `PHP 15,000` does not also report `PHP 15`. |
| `match.ts` | Scores the document's vocabulary against the org's own requirement-item labels (plus an EN/Filipino governance lexicon): phrase hits + cosine. |
| `signals.ts` | The closed inventory of findings (`SignalCode`), each with a fixed label and recommendation, fired only by deterministic triggers. |
| `engine.ts` | Combines submission state, extraction result, facts, match and signals into a status per item (`missing` / `unreadable` / `suspect` / `ok`), a recommendation, and the `ComplianceReport`. |

Two rules in there were learned from real cases, not designed on paper:

- **The self-naming rule.** A document whose text says what it is ("LETTER OF INTENT")
  wins its own item: if the document names its own requirement as well as anything else
  matches it, `bestItemId` is the item itself. Without this, thin but honest documents got
  flagged as "belongs under another requirement" simply because their vocabulary is short.
- **The category rule.** A category term counts only when it appears *inside* the
  requirement item's own label. The first implementation applied every category to every
  item, which equalised all scores and let cosine noise decide classification.

## 4. Route and authorization

`POST /api/compliance/[versionId]`, body `{ proposalId }`, `runtime = "nodejs"`.

Authorization is **inherited, not re-decided**: the route reads the proposal through the
same `proposal_detail` RPC the UI already uses, then fetches each file through
`get_document` → `readLargeObject`. Whoever could open the proposal can run the check;
nobody else can. Abuse is bounded by the standard in-process limiter
(`rateLimit("compliance:ip:…")`, 20 checks per 5 minutes per IP) — the limit is on spam,
not on legitimate re-runs.

The report is never stored. It is computed, returned, and gone; re-running it is cheap.

## 5. UI

`RequirementCheckPanel` sits directly above `VerificationChecklist` in
`ProposalDetailFlow.tsx`, for both reviewer and author views. Per item it renders the
status badge, the recommendation, the signals colour-coded by level (info/warn/block), the
extracted facts as chips, a two-line preview of the document's text, and — when content
resembles a *different* requirement item — the misfiling warning naming that item.

## 6. Validation

`npm run check:compliance` runs `scripts/check-compliance.ts` against generated fixtures
(`npm run fixtures:compliance` → `scripts/fixtures/`): a real PDF letter, a blank PDF, a
DOCX, an XLSX budget, plain text, a placeholder file, and a link item. It asserts
extraction per format, fact extraction, self-matching, the status of every fixture,
actionable recommendations everywhere, and a cold run under 5 seconds. Current state:
**ALL PASS, ~2–3s for 7 items**, with `tsc --noEmit`, `eslint`, and `next build` all clean.

The engine's extraction is verified on real bytes, not mocks — that is the whole point of
the fixture generator.

## 7. Pre-flight check

Authors can run **Pre-flight check** inside the submission and revision forms before
sending anything to USG. It is the same deterministic reading aid as the reviewer check,
but it runs against the draft items the author is about to submit.

- The browser extracts text from selected files; no file bytes, storage paths, or link
  fetches reach the route.
- `runPreflightCheck` shares the deterministic item logic with `runComplianceCheck`, so
  the same document receives the same finding whether previewed or reviewed.
- AI advice is optional. It may add suggested fixes, but it cannot change an item status,
  block a submission, or write a domain record. The deterministic report remains
  authoritative.
- Images need a configured vision model. Without one they stay `ocr_pending`, and the
  author can still send the requirement for human review.
- Nothing from pre-flight is stored. The report is computed from the request and returned.
- The route is `POST /api/compliance/precheck`; it requires a signed-in account and is
  limited to 30 requests per 5 minutes per IP.
