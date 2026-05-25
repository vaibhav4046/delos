// B10 · write-guard for memory facts.
//
// Brutal-QA 2026-05-25 found run-summary text + persona preamble fragments
// flowing into the pinned-facts store, then re-surfacing as "user facts"
// during recall. This rejected list defangs the worst offenders before
// any write reaches HydraDB.
//
// Returns { ok: true } when the text is allowed, { ok: false, reason }
// when it should be rejected with HTTP 400.

const BLOCK_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "preamble-suffix", re: /\(apply to every output\)/i },
  { name: "run-summary-prefix", re: /^Run completed for goal/i },
  { name: "tone-preamble", re: /^tone:\s*(concise|verbose|balanced)/i },
  { name: "redacted-stub", re: /\[REDACTED\]/i },
  { name: "system-prompt-leak", re: /SYSTEM[_\s-]?PROMPT\b/i },
  // QA P1 · noisy run metrics like "drift=0.05 tokens=1247 ms=540" were
  // flowing into pinned memory and resurfacing as user-facts during
  // recall. Block any text that's predominantly key=value telemetry.
  { name: "run-metric-noise", re: /^\s*(?:drift|tokens?|completion_tokens?|prompt_tokens?|elapsed|ms|wall_time|cost|usd|tier|replans?|tool_calls?)\s*[:=]/i },
  { name: "run-metric-cloud", re: /\b(?:drift\s*[:=]\s*0?\.\d+|tokens\s*[:=]\s*\d+|ms\s*[:=]\s*\d+|usd\s*[:=]\s*\$?\d+)\b.*\b(?:drift\s*[:=]|tokens\s*[:=]|ms\s*[:=])\b/i },
];

// A "verb" presence check for the long-text rule. Run-summary lines are
// often >240 chars but contain no real predicate; user facts at >240 chars
// usually contain at least one indicative verb.
const VERB_RE = /\b(is|are|was|were|will|be|did|do|does|has|have|had|run|build|prefer|like|own|use|need|want|saved|stored|added|removed|change|set|enable|disable)\b/i;

export type WriteGuardVerdict =
  | { ok: true }
  | { ok: false; reason: string };

export function guardMemoryWrite(text: string): WriteGuardVerdict {
  if (typeof text !== "string") return { ok: false, reason: "not-a-string" };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  for (const { name, re } of BLOCK_PATTERNS) {
    if (re.test(trimmed)) return { ok: false, reason: name };
  }
  if (trimmed.length > 240 && !VERB_RE.test(trimmed)) {
    return { ok: false, reason: "looks-like-run-summary" };
  }
  return { ok: true };
}
