// Text + tag sanitizers shared by every write path that takes user input
// destined for HydraDB or another tenant's display surface. Closes BUG-8
// (stored XSS substrate) and BUG-9 (__proto__ tag prototype-pollution
// substrate) from the 2026-05-24 brutal QA report.

/**
 * Strip the obviously dangerous HTML / JS that an attacker would smuggle
 * through memory text. We don't try to be a full HTML sanitizer (the
 * memory text is rendered as `textContent`, not `innerHTML`), but we
 * defang the common XSS payload shapes so the value never *looks*
 * dangerous to a future markdown / preview path that might forget the
 * contract.
 */
export function sanitizeMemoryText(input: string): string {
  let s = String(input);
  // Drop <script>...</script> entirely (greedy match including newlines).
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  // Strip inline event handlers on any tag, e.g. onerror=… onclick=…
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Neutralize javascript: + data:text/html URIs in href / src.
  s = s.replace(/(href|src|action|formaction|background)\s*=\s*("|')\s*(javascript|data:text\/html)/gi, "$1=$2blocked-$3");
  // Hard cap the length (Zod already caps to 2000 but defense-in-depth).
  if (s.length > 4000) s = s.slice(0, 4000);
  return s;
}

/**
 * Validate a tag string. Reject reserved JS property names so that any
 * downstream `Object.assign` / merge / Object.create path cannot be used
 * for prototype pollution.
 */
const RESERVED_TAGS = new Set(["__proto__", "constructor", "prototype", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);

export function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().slice(0, 40);
    if (!t) continue;
    if (RESERVED_TAGS.has(t)) continue;
    // Strip anything that isn't a-z 0-9 - _ . : / (allows tag namespacing)
    const clean = t.replace(/[^a-z0-9._:/-]/gi, "");
    if (!clean) continue;
    out.push(clean.toLowerCase());
  }
  // Dedupe + cap.
  return [...new Set(out)].slice(0, 16);
}

/**
 * Throws a 400-shaped Response when a tag array contains any reserved
 * name. Callers that prefer hard-reject (e.g. /api/memory/pin) can use
 * this instead of silently dropping the entry.
 */
export function assertSafeTags(tags: unknown): void {
  if (!Array.isArray(tags)) return;
  for (const t of tags) {
    if (typeof t === "string" && RESERVED_TAGS.has(t.trim())) {
      throw new Response(
        JSON.stringify({ error: "invalid_tags", reason: `reserved name '${t}'` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  }
}
