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
const CONNECTORS = /\s*(?:,|;| then | and then | after that | also | plus | next )\s*/i;

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
    for (const s of sub) {
      const m = s.match(new RegExp(`\\b(${VERB_GROUP})\\b`, "i"));
      const verb = m ? m[1].toLowerCase() : null;
      chunks.push({ text: s, verb, label: s.length > 50 ? s.slice(0, 47) + "…" : s });
    }
  }
  return chunks;
}
