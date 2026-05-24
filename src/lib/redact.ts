// PII redaction — strips emails, phone numbers, credit-card-shaped digits,
// API key shapes, IPv4 from any string before it enters the durable event log.

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /(?:\+?\d{1,3}[\s.-])?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const CC = /\b(?:\d[ -]*?){13,19}\b/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const API_KEY = /\b(sk-|gsk_|sk_live_|sk_test_|AIza[a-zA-Z0-9_-]{20,}|xoxb-[a-zA-Z0-9-]+)[A-Za-z0-9_\-.]{8,}/g;

export function redact(input: string): string {
  if (!input || typeof input !== "string") return input;
  return input
    .replace(API_KEY, "[REDACTED_KEY]")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(PHONE, "[REDACTED_PHONE]")
    .replace(CC, "[REDACTED_CARD]")
    .replace(IPV4, "[REDACTED_IP]");
}

// Walk arbitrary JSON-shaped object, redact every string leaf.
export function redactDeep<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
