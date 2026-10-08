/**
 * The comparison layer: does this document's content actually resemble the
 * requirement it was filed under, and does it resemble some *other* item in the
 * same version more?
 *
 * Scope rule: the vocabulary the matcher knows is the app's own. The comparison
 * set is the submitted version's requirement items, and the synonym lexicon below
 * only contains governance/event-document terms in English and Filipino. A document
 * about anything else simply scores low -- that is the "unrecognized" answer, not
 * an open-world summary.
 *
 * The score is explainable (two parts, both published here):
 *
 *   phraseHits  - multi-word domain phrases found in the text, weighted by length
 *   cosine      - TF-IDF cosine between the document's token vector and the item's
 *
 *   score = 0.55 * min(1, phraseHits / 8) + 0.45 * cosine
 */
import type { MatchResult } from "./types";

type Item = { itemId: string; label: string };

const STOPWORDS = new Set(
  ("a an the and or of to for with on in at by from we our us i you your it its this that is are was were be have has had will would can could shall should not no nor but if then so as per all any each date please thank respect sincerely regards council government office student association unit program proposal activity event day time").split(
    " ",
  ),
);

const CATEGORY_LEXICON: Record<string, string[]> = {
  letter: [
    "letter of intent",
    "letter",
    "cover letter",
    "formal letter",
    "sang-ayon",
    "sulat",
    "pahayag",
    "intent",
    "application letter",
  ],
  attendance: [
    "attendance sheet",
    "attendance",
    "list of attendees",
    "participants",
    "sign in sheet",
    "listahan",
    "dalo",
    "present",
    "roster of attendees",
  ],
  permit: [
    "permit",
    "venue permit",
    "clearance",
    "certificate of approval",
    "security",
    "osa",
    "facilities",
    "authorization",
    "pahintulot",
    "lisensya",
    "approval letter",
  ],
  financial: [
    "budget breakdown",
    "budget proposal",
    "financial statement",
    "fund",
    "funding",
    "source of funds",
    "liquidat",
    "statement of account",
    "cash",
    "allocation",
    "sponsor",
    "donation",
    "financial report",
    "gastos",
    "aplay",
    "cost",
    "expense",
    "estimates",
  ],
  proposal: [
    "program proposal",
    "project proposal",
    "activity proposal",
    "panukala",
    "proposal",
    "plan",
    "proyekto",
    "design",
    "concept note",
  ],
  programflow: [
    "program flow",
    "programme",
    "sequence of activities",
    "lineup",
    "itinerary",
    "schedule",
    "timeline",
    "iskedyul",
    "programme of activities",
    "segments",
    "run of show",
  ],
  minutes: [
    "minutes of meeting",
    "minutes",
    "katitikan",
    "meeting notes",
    "resolution",
    "resolusyon",
  ],
  report: [
    "accomplishment report",
    "narrative report",
    "report",
    "ulat",
    "summary of activities",
    "after activity report",
    "documentation",
  ],
  endorsement: [
    "endorsement",
    "letter of support",
    "rekomendasyon",
    "recommendation",
    "adviser",
    "adviser's endorsement",
    "support letter",
  ],
  waiver: [
    "waiver",
    "consent form",
    "parental consent",
    "pahintulot ng magulang",
    "liability",
    "release form",
    "disclaimer",
  ],
  photo: [
    "photo documentation",
    "pictures",
    "photos",
    "galleries",
    "larawan",
    "picture evidence",
    "mga larawan",
  ],
  itinerary: [
    "itinerary",
    "travel plan",
    "route",
    "map",
    "transportation",
    "sasakyan",
    "transport",
  ],
  promo: [
    "promotional materials",
    "poster",
    "tarpaulin",
    "poster design",
    "marketing",
    "patalastas",
  ],
};

function categoryOf(label: string): string[] {
  const lower = label.toLowerCase();
  const cats: string[] = [];
  for (const [cat, terms] of Object.entries(CATEGORY_LEXICON)) {
    // A category counts when a term of it appears inside the label itself
    // ("Letter of Intent" contains "letter of intent"; "Financial Statement /
    // Budget Breakdown" contains "financial", "statement" and "budget").
    for (const term of terms) {
      if (term.length >= 3 && lower.includes(term)) {
        cats.push(cat);
        break;
      }
    }
  }
  return cats;
}

function expandLabel(label: string, categories: string[]): string[] {
  const out = new Set<string>();
  for (const w of label.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 3) out.add(w);
  }
  for (const cat of categories) {
    for (const term of CATEGORY_LEXICON[cat] ?? []) out.add(term);
  }
  return [...out];
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]+/g, " ");
}

function tokens(normalized: string): string[] {
  const words = normalized.split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i += 1) bigrams.push(`${words[i]} ${words[i + 1]}`);
  return [...words, ...bigrams];
}

function vectorOf(tokens: string[]): Map<string, number> {
  const v = new Map<string, number>();
  for (const t of tokens) v.set(t, (v.get(t) ?? 0) + 1);
  return v;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, x] of a) {
    na += x * x;
    const y = b.get(k);
    if (y) dot += x * y;
  }
  for (const x of b.values()) nb += x * x;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function matchDocumentAgainstItems(text: string, items: Item[], ownItemId: string): MatchResult {
  const normalized = normalize(text);
  const docTokens = tokens(normalized);
  const docVec = vectorOf(docTokens);
  const docText = text.toLowerCase();

  // Document frequency across items, for TF-IDF of the comparison side.
  const docFreq = new Map<string, number>();
  const itemVecs = items.map((item) => {
    const expanded = expandLabel(item.label, categoryOf(item.label));
    const vec = vectorOf(expanded.map((t) => t.replace(/[^a-z0-9\s]+/g, " ").trim()));
    for (const term of expanded) {
      const key = term.replace(/[^a-z0-9\s]+/g, " ").trim();
      if (key) docFreq.set(key, (docFreq.get(key) ?? 0) + 1);
    }
    return { item, vec, expanded: expanded.map((t) => t.toLowerCase()) };
  });

  const nItems = Math.max(1, items.length);
  const idf = (term: string) => Math.log((nItems + 1) / ((docFreq.get(term) ?? 0) + 1)) + 1;

  const scores = itemVecs.map(({ item, vec, expanded }) => {
    // Phrase hits: strip multi-word terms from the expanded set (they are the
    // domain phrases), count how often the phrase appears in the text.
    let phraseHits = 0;
    for (const term of expanded) {
      if (!term.includes(" ")) continue;
      const ph = term.replace(/[^a-z0-9\s]+/g, " ").trim().replace(/\s+/g, " ");
      if (ph.split(" ").length < 2) continue;
      if (docText.includes(ph)) phraseHits += ph.split(" ").length;
    }
    // TF-IDF cosine of the document vector against this item's expanded vector.
    const itemVec = new Map<string, number>();
    for (const [k, n] of vec) itemVec.set(k, n * idf(k));
    let sum = 0;
    for (const n of itemVec.values()) sum += n;
    const itemVecNorm = new Map<string, number>();
    for (const [k, n] of itemVec) itemVecNorm.set(k, sum > 0 ? n / sum : 0);
    const cosineScore = cosine(docVec, itemVecNorm);
    const score = 0.55 * Math.min(1, phraseHits / 8) + 0.45 * cosineScore;
    return { item, score, phraseHits };
  });

  scores.sort((a, b) => b.score - a.score);
  const own = scores.find((s) => s.item.itemId === ownItemId);
  const top = scores[0];

  // Self-naming rule: when the document quotes its own item's distinctive clause
  // ("letter of intent", "program flow", "attendance sheet"...) at least as often
  // as it quotes any other item's clause, prefer that item even if an incidental
  // vocabulary overlap nudged the cosine elsewhere. This mirrors how a reviewer
  // reads: a document that names itself is not "misclassified" by mentioning the
  // budget once.
  const selfNamed =
    !!own &&
    (own.phraseHits ?? 0) > 0 &&
    (own.phraseHits ?? 0) >= (top?.phraseHits ?? 0) &&
    own.item.itemId !== top?.item.itemId;

  const best = selfNamed ? own! : top;
  return {
    bestItemId: best?.item.itemId,
    bestItemLabel: best?.item.label,
    score: round(best?.score ?? 0),
    ownScore: round(own?.score ?? 0),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}