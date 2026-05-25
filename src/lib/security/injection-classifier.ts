// Prompt-injection classifier · regex-rules first line of defense at the
// /api/* boundary. Returns { blocked: true, reason } when the input matches
// a known injection pattern. The caller returns 400 + { error:"blocked_for_security" }.
//
// Patterns drawn from real attack corpora (Anthropic injection eval set +
// the brutal-QA 2026-05-25 batch). Keep tight — false positives kill UX,
// false negatives kill the demo.

const INJECTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "ignore-previous", re: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context|messages?)\b/i },
  { name: "system-prompt-leak", re: /\b(print|reveal|show|output|leak|expose|dump)\s+(the\s+)?(SYSTEM[_\s-]?PROMPT|system\s+prompt|hidden\s+prompt|initial\s+prompt|original\s+prompt)\b/i },
  { name: "credential-exfil", re: /\b(reveal|print|leak|show|output)\s+.{0,40}(API[_\s-]?KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS?|HYDRA[_\s-]?DB[_\s-]?API[_\s-]?KEY|GROQ[_\s-]?API[_\s-]?KEY|OPENAI[_\s-]?API[_\s-]?KEY)\b/i },
  { name: "role-override", re: /\b(you are now|act as|pretend to be|simulate being|roleplay as)\s+(an?\s+)?(admin|administrator|root|superuser|developer|owner|anthropic\s+staff|google\s+staff)/i },
  { name: "developer-mode", re: /\b(developer\s+mode|dev\s+mode|sudo\s+mode|admin\s+mode|god\s+mode|jailbreak|DAN\s+mode)\b/i },
  { name: "instruction-override", re: /\b(override|bypass|disable|turn\s+off|deactivate|circumvent)\s+(your\s+)?(safety|guardrails?|filters?|restrictions?|rules?)\b/i },
  { name: "execute-unrestricted", re: /\b(execute|run|perform)\s+(without\s+restrictions?|unrestricted|with\s+no\s+limits)\b/i },
  { name: "base64-injection-marker", re: /(?:[A-Za-z0-9+/]{60,}={0,2}.*decode|decode.*base64.*and.*(execute|run|follow))/i },
];

export type InjectionVerdict =
  | { blocked: false }
  | { blocked: true; reason: string; pattern: string };

export function classifyInjection(text: string): InjectionVerdict {
  if (typeof text !== "string" || text.length === 0) return { blocked: false };
  // Cap scan length to prevent ReDoS on hostile mega-payloads.
  const sample = text.length > 5000 ? text.slice(0, 5000) : text;
  for (const { name, re } of INJECTION_PATTERNS) {
    if (re.test(sample)) return { blocked: true, reason: "blocked_for_security", pattern: name };
  }
  return { blocked: false };
}

// Title sanitizer · DOMPurify-equivalent for plain text + 60-char cap.
// Rejects all-lowercase-no-punctuation strings (likely prompt-injection
// echo) and any string containing HTML-ish brackets.
export function sanitizeTitle(raw: string, fallback = "Generated App"): string {
  if (!raw || typeof raw !== "string") return fallback;
  let t = raw.replace(/[<>{}]/g, "").replace(/\s+/g, " ").trim();
  if (t.length > 60) t = t.slice(0, 57) + "…";
  // All-lowercase, no punctuation, > 4 words → likely a prompt fragment,
  // not a title. Fall back.
  if (!/[A-Z.!?]/.test(t) && t.split(/\s+/).length > 4) return fallback;
  // Empty after sanitization → fallback.
  if (!t) return fallback;
  return t;
}
