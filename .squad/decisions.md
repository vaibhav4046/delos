# Decisions

Append-only log of team-wide decisions. Each entry: date, decision, rationale,
alternatives considered, who's affected.

## 2026-05-24 · Adopt Squad charter pattern

Decision: adopt Squad's markdown-charter convention (github.com/bradygaster/squad)
for documenting the DelOS multi-agent team.

Rationale: the planner / executor / critic / memory / codegen agents were
implicit in `src/lib/agents/`. New collaborators couldn't grok the team
without reading source. Charters give one-page contracts per agent.

Alternatives:
- Run Squad CLI directly — rejected. Squad's runner shells out to GitHub
  Copilot CLI; DelOS runs its own Next.js + Vercel stack. Wrong fit.
- Keep status quo — rejected. Implicit team = onboarding tax for every
  new agent or collaborator.

## 2026-05-24 · LLM provider cascade order

Decision: Groq scout-17b → OpenRouter qwen-3-coder → Gemini 2.5 Flash → Mistral small.

Rationale: Kimi K2 + Maverick 128e are paid-only on Groq for this account.
Scout-17b is the fastest free option (2-3s/call). OpenRouter qwen-3-coder
provides better JSX validity for clone work. Gemini and Mistral give
provider-diversity for rate-limit + invalid-JSON cascading.

Alternatives:
- Single provider — rejected. 8-14 file codegen exhausts 30K Groq TPM.
- Gemini primary — rejected. 6-15s/call × 14 files = blows Vercel 90s ceiling.

## 2026-05-24 · Sandpack for live preview

Decision: Codebase Builder runs generated projects via @codesandbox/sandpack-react
in an iframe inside the OS window.

Rationale: the user wants to SEE the clone work, not just read the code.
Sandpack bundles in-browser, no server build, runs without leaving the OS.

Alternatives:
- Server-side bundle then iframe → rejected. Adds infra; Sandpack is client-only and free.
- Download ZIP only → rejected. Friction for demos.

## 2026-05-24 · Secrets encryption at rest

Decision: connector tokens (Notion / Gmail / Microsoft / manual paste) are
AES-256-GCM encrypted before HydraDB persistence. See `src/lib/secrets.ts`.

Rationale: `text` field is surfaced to LLM context on recall — plaintext
token would leak via any agent that reads memory. Cipher in `metadata.tokenCipher`,
redacted preview in `text`.

## 2026-05-24 · ApprovalGate race-proof

Decision: ApprovalGate decision uses module-scoped `_resolvers` Map +
`isTrusted` check on click, NOT a window event for the decision side.

Rationale: an attacker script with same-origin XSS could listen for the
request event and dispatch a forged "approved=true" before the modal shows.
Module-scope map is unreachable from window scope; isTrusted blocks synthetic
click events.
