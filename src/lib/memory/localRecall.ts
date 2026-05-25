// B08 · query-sensitive local recall.
//
// Brutal-QA 2026-05-25 caught the memory route returning chronological
// dumps regardless of query. Fix: token overlap × IDF weight × recency
// half-life (72h). Empty query → 0 hits. Unmatched query → 0 hits.
//
// This is intentionally cheap (no embeddings, no model call) so it runs
// in <2ms per call against the local fallback array. HydraDB's semantic
// vector recall remains the primary source; this layer makes the local
// passthrough trustworthy.

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "at",
  "is", "are", "was", "were", "be", "been", "by", "with", "as", "it",
  "this", "that", "these", "those", "what", "which", "who", "when",
  "where", "why", "how", "do", "does", "did", "i", "you", "we", "they",
]);

export function tokenize(s: string): string[] {
  // Split on whitespace + punctuation + underscores so identifier-style
  // facts (favorite_color = ...) match free-text queries ("favorite color").
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/[\s_]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Lazy IDF over the corpus the caller passes in. We rebuild per-call —
// the local arrays are tiny (≤50 entries) so the cost is negligible.
function buildIdf(corpus: string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of corpus) {
    const seen = new Set(tokenize(doc));
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = Math.max(1, corpus.length);
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log(1 + N / n));
  return idf;
}

export type LocalMem = { text: string; createdAt?: number };

export function scoreLocal(query: string, mem: LocalMem, idf: Map<string, number>): number {
  if (!query.trim()) return 0;
  const qt = tokenize(query);
  if (qt.length === 0) return 0;
  const mt = tokenize(mem.text);
  if (mt.length === 0) return 0;
  const overlap = qt.filter((t) => mt.includes(t));
  if (overlap.length === 0) return 0;
  const idfSum = overlap.reduce((sum, t) => sum + (idf.get(t) ?? 1), 0);
  const sim = overlap.length / qt.length;
  const ageH = mem.createdAt ? (Date.now() - mem.createdAt) / 3.6e6 : 24;
  const recency = Math.exp(-ageH / 72);
  return sim * idfSum * (0.6 + 0.4 * recency);
}

export function recallLocal(query: string, mems: LocalMem[], topK: number): LocalMem[] {
  if (!query.trim() || mems.length === 0) return [];
  const idf = buildIdf(mems.map((m) => m.text));
  const scored = mems
    .map((m) => ({ m, s: scoreLocal(query, m, idf) }))
    .filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, topK).map((x) => x.m);
}
