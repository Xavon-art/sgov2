/**
 * Key-fact extraction. The "info extraction" part of the check: a letter of
 * intent usually carries a date, a budget usually carries an amount, and a
 * compliant document usually names who it is from. These are regexes plus a tiny
 * month lexicon -- no model, no API, fast, and entirely inside the app's domain.
 */
import type { KeyFact } from "./types";

const MONTHS =
  "jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december";

const DATE_PATTERNS: Array<{ kind: "date"; re: RegExp }> = [
  { kind: "date", re: /\b\d{4}-\d{1,2}-\d{1,2}\b/g },
  { kind: "date", re: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  { kind: "date", re: new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2},?\\s+\\d{4}\\b`, "gi") },
  { kind: "date", re: new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})\\s+\\d{4}\\b`, "gi") },
  { kind: "date", re: new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}\\b`, "gi") },
];

const AMOUNT_PATTERNS: Array<{ kind: "amount"; re: RegExp }> = [
  { kind: "amount", re: /(?:₱|PHP|Php|Peso|pesos?)\s?\d{1,3}(?:,\d{3})+(?:\.\d{2})?/g },
  { kind: "amount", re: /(?:₱|PHP|Php|USD|\$)\s?\d{1,3}(?:\.\d{2})?/g },
  { kind: "amount", re: /(?:total\s+)?(?:budget|fund|cost|amount|php)\s*:?\s*(?:\d{1,3}(?:,\d{3})*|\d+)(?!\d)/gi },
];

const EMAIL_PATTERNS: Array<{ kind: "email"; re: RegExp }> = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
];

/** "Ref No. RO-2026-001", "Reference Number: 2026-101", "WBS-2026-0042". */
const REFERENCE_PATTERNS: Array<{ kind: "reference"; re: RegExp }> = [
  { kind: "reference", re: /\b(?:ref(?:erence)?|control)?\s*no\.?\s*[:\-]?\s*[A-Z0-9][A-Z0-9/._\-]{2,20}\b/gi },
  { kind: "reference", re: /\b(?:[A-Z]{2,6}-\d{2,4}-\d{2,6}|[A-Z]{2,6}-\d{3,8})\b/g },
];

const CAP: Record<KeyFact["kind"], number> = { date: 5, amount: 5, email: 3, reference: 5 };

export function extractFacts(text: string): KeyFact[] {
  const seen = new Set<string>();

  const patterns: Array<{ kind: KeyFact["kind"]; re: RegExp }> = [
    ...DATE_PATTERNS,
    ...AMOUNT_PATTERNS,
    ...EMAIL_PATTERNS,
    ...REFERENCE_PATTERNS,
  ];

  const picks: KeyFact[] = [];
  for (const { kind, re } of patterns) {
    for (const match of text.matchAll(re)) {
      const raw = match[0].trim();
      if (!raw) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      // Toss dates that are clearly years alone ("2026"), which the ISO pattern
      // would otherwise capture as a fragment.
      if (kind === "date" && /^\d{4}$/.test(raw)) continue;
      const value = raw.replace(/\s+/g, " ");
      // Drop values swallowed by a longer fact of the same kind, so "PHP 5" does
      // not sit next to "PHP 5,000" and "October 8" next to "October 8, 2026".
      if (picks.some((f) => f.kind === kind && f.value.includes(value))) continue;
      picks.push({ kind, value });
      if (picks.filter((f) => f.kind === kind).length >= CAP[kind]) break;
    }
  }
  return picks;
}