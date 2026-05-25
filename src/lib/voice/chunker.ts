// B11 · voice multi-intent chunker.
//
// Brutal-QA 2026-05-25 caught compound voice commands silently dropping
// every verb after the first. Fix: split on conjunctions first, then on
// additional verb occurrences inside each part. Each chunk becomes one
// intent for the executor to fan out over.
//
// Pure function so the chunker can be unit-tested without an LLM.

const VERBS = [
  "open", "launch", "start", "build", "make", "create", "generate",
  "calculate", "compute", "research", "summarize", "summarise",
  "email", "draft", "write", "send", "close", "find", "search",
  "recall", "remember", "remind", "schedule", "play", "show",
  "export", "share", "stop", "pause", "resume", "set", "change",
  "switch", "navigate", "go", "list", "delete", "copy", "paste",
] as const;

const VERB_GROUP = VERBS.join("|");
// Connector tokens that split compound voice commands. Adding bare ` and `
// as a split point so "open browser and search X" cleanly splits into
// ["open browser", "search X"] instead of leaving "and" glued to the
// browser chunk producing the "browserand" ghost reported in 2026-05-25 QA.
const CONNECTORS = /\s*(?:,|;| then | and then | and | after that | also | plus | next )\s*/i;
// F13 · pure-connective tokens that should never become an intent chunk
const GHOST_TOKENS = new Set(["then", "and", "and then", "after that", "also", "plus", "next", ","]);
// Trailing/leading connector cleanup · catches "and", "then" left glued
// to a chunk after verb-based split.
const TRAILING_CONNECTOR_RE = /\s+(and|then|or|also|plus|next|,)\s*$/i;
const LEADING_CONNECTOR_RE = /^(and|then|or|also|plus|next)\s+/i;

export type IntentChunk = {
  text: string;
  verb: string | null;
  label: string;
};

export function chunkVoice(rawText: string): IntentChunk[] {
  const text = (rawText ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  // First pass · split on explicit conjunctions / commas / semicolons.
  const parts = text
    .split(CONNECTORS)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: IntentChunk[] = [];
  for (const part of parts) {
    // Second pass · within a single part, split on additional verb occurrences
    // so "open terminal calculate 17 times 19" → 2 intents.
    const verbRe = new RegExp(`(?=\\b(?:${VERB_GROUP})\\b)`, "ig");
    const sub = part.split(verbRe).map((s) => s.trim()).filter(Boolean);
    for (const sRaw of sub) {
      // Strip leading + trailing connector words ("and", "then", "or")
      // so chunks don't leak "open browser and" / "and search foo".
      const s = sRaw.replace(LEADING_CONNECTOR_RE, "").replace(TRAILING_CONNECTOR_RE, "").trim();
      // F13 · drop ghost connective chunks ("then", "and") that have no verb
      // AND match a pure-connective token. Real chunks (even verb-less ones
      // like "tip calculator") keep going.
      const lower = s.toLowerCase().trim();
      if (GHOST_TOKENS.has(lower) || lower.length <= 1) continue;
      const m = s.match(new RegExp(`\\b(${VERB_GROUP})\\b`, "i"));
      const verb = m ? m[1].toLowerCase() : null;
      // Skip chunks that are purely the connector word with no other content
      if (!verb && /^(then|and|or|also|plus|next)\b\s*$/i.test(lower)) continue;
      chunks.push({ text: s, verb, label: s.length > 50 ? s.slice(0, 47) + "…" : s });
    }
  }
  return chunks;
}
