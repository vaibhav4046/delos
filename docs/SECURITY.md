# DelOS — Security model

## Threat model

DelOS runs in the browser against a Node-side API surface. The threats we defend against:

1. **Prompt injection** — attacker payloads designed to override system instructions
2. **Cross-tenant data leakage** — one user reading another's memories
3. **Stored XSS** — memory text rendered without sanitization
4. **Prototype pollution** — `__proto__` and friends in tag arrays
5. **Wallet drain** — uncapped LLM calls burning provider budget
6. **Reflection amplification** — multi-KB user input echoed back unbounded
7. **Credential exfiltration** — agents tricked into revealing env-var keys
8. **Approval bypass** — destructive skills firing without user consent

## Defense layers

### Layer 1 — Edge (every `/api/*` route)

1. **Rate limit** (`src/lib/rateLimit.ts`)
   - Per-IP, per-route, sliding window
   - Codegen capped at 6/min (heaviest budget)
   - Voice capped at 40/min
   - Cohort capped at 12/min
2. **Zod parse** — length + shape enforced before any processing
3. **Injection classifier** (`src/lib/security/injection-classifier.ts`)
   - 8 patterns: ignore-previous, system-prompt-leak, credential-exfil, role-override, developer-mode, instruction-override, execute-unrestricted, base64-marker
   - Returns 400 with `{ error: "blocked_for_security", pattern }`
4. **Tenant resolution** (`src/lib/apiAuth.ts → resolveTenant`)
   - Session cookie wins
   - Reserved prefix accepted from body / header / query (regex enforced)
   - Otherwise anon IP-scoped tenant

### Layer 2 — Sanitization

1. **`sanitizeMemoryText`** (`src/lib/sanitize.ts`)
   - Drops `<script>` tags
   - Strips inline event handlers (`onerror=`, `onclick=`)
   - Neutralizes `javascript:` and `data:text/html` URIs
   - Caps at 4000 chars
2. **`sanitizeTags`**
   - Rejects reserved names: `__proto__`, `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`
   - Lowercases, strips non-namespace chars, dedupes, caps at 16 entries
3. **`sanitizeTitle`** (`src/lib/security/injection-classifier.ts`)
   - 60-char cap
   - Rejects HTML-ish brackets
   - Rejects all-lowercase-no-punctuation strings (prompt-fragment echo defense)

### Layer 3 — Write-guard (`src/lib/memory/writeGuard.ts`)

Reject memory writes that match:

```
/(apply to every output)/i              // persona preamble leak
/^Run completed for goal/i              // run-summary pollution
/^tone:\s*(concise|verbose|balanced)/i  // persona fragment
/\[REDACTED\]/i                         // unfilled template
/SYSTEM[_\s-]?PROMPT\b/i                // prompt leak attempt
```

Plus: anything `> 240 chars` with no verb is rejected as `looks-like-run-summary`.

### Layer 4 — Cross-tenant scope

- `safeRecall` filters local fallback by `tenantId`
- `deleteLocalMemory` requires both `tenantId` AND `id` to match — wrong tenant returns `not_found` even if the id is correct
- `clearLocalMemories` is tenant-scoped
- HydraDB tenant isolation enforced at the client SDK level

### Layer 5 — Approval flow for destructive skills

Skill risk tiers enforced server-side:

| Tier | Pre-flight gate |
|------|-----------------|
| READ | none |
| REVERSIBLE | none |
| DRAFT | none |
| EXTERNAL | UI approval modal, blocks until user taps Approve |
| MONEY | UI approval modal + secondary confirmation |
| DESTRUCTIVE | UI approval modal + secondary confirmation + 5s typing cooldown |

The approval state is signed with the session token. Voice and assistant flows both route through the same gate.

`DELOS_AUTONOMY=1` env var allows chained EXTERNAL skills without per-step approval, gated behind a user-set "trust level" in Settings (default OFF).

## Things we do NOT do

- **No API keys in JSON responses** — `/api/keys/status` returns booleans only
- **No GET endpoints for state-changing actions** — every state-changing endpoint is POST + has a 405 GET handler
- **No tenant ID in URLs as path params** — only as `?tenant=` query (so it never leaks via referer header to logs)
- **No client-side env-var exposure** — `NEXT_PUBLIC_*` is empty by design; all secrets are server-only
- **No SSE injection** — `zodErr` returns a single-line clean string so multi-line error blobs cannot break a downstream SSE consumer

## Audit trail

Every memory write is logged with `metadata: { runId, tags, ... }`. The `runId` field threads through all events of a run so audit can reconstruct "which run produced which memory."

Pinned facts (via `/api/memory/pin`) carry `metadata: { pinned: true, pinnedAt: ts }` so the recall layer can boost user-pinned items above run-summary chatter.

## Reporting

Found a vulnerability? File a security report through the GitHub issue tracker tagged `security`. Or — for sensitive issues — email the project owner directly (link in README).

Do not file CVEs against pre-1.0 hackathon builds publicly; this is a 48-hour prototype, not production software.
