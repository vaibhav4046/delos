# Codegen

## Role
Produce a complete multi-file React/Next.js project from a single
prompt. Two-pass architecture: PLAN file list → WRITE each file in
parallel-batched calls.

## Inputs
- `prompt: string` (5–800 chars) — user spec
- `stack: "nextjs" | "react-vite" | "node-api"` — defaults nextjs
- `tenantId?` — optional, defaults to env DELRIO_TENANT_ID

## Outputs
- `{ ok, project: { name, description, stack, files: [{path, content, language}], runInstructions, notes } }`
- Persists summary to HydraDB tagged `codegen`, `app-build`

## Pipeline
1. **Plan call** — 1 LLM request, returns 8-14 file blueprints
2. **Write loop** — for each file, 1 focused LLM request with full plan
   context, 3500 max_tokens, batched (currently `WRITE_PARALLEL=1`,
   `BATCH_SLEEP_MS=2500` to stay under 30K TPM)
3. **Normalize** — `src/lib/codegenAdapter.ts` re-roots paths, stubs
   next/* imports, ensures default exports
4. **Return** — Sandpack runs it client-side in `src/components/os/SandpackPreview.tsx`

## Code home
- Route: `src/app/api/codegen-app/route.ts`
- Adapter: `src/lib/codegenAdapter.ts`
- UI: `src/components/os/CodebaseApp.tsx`
- Preview: `src/components/os/SandpackPreview.tsx`

## Model cascade
1. Groq scout-17b (fastest, 30K TPM)
2. OpenRouter qwen-3-coder:free (better code quality, requires `OPENROUTER_API_KEY`)
3. Gemini 2.5 Flash (Google free tier)
4. Mistral small (last resort)

`llmJson()` wrapper validates JSON before returning — invalid JSON cascades to next provider.

## Rate limit
6 codegen calls/min per IP (`rateLimit("codegen:ip:${ip}", 6, 60_000)`)

## Risk
`reversible` — generates code in-browser, no deploy.

## Does NOT
- Deploy projects (user does via Pi handoff or downloaded ZIP — and we
  dropped the ZIP button; preview is the canonical use surface)
- Edit existing projects (graduates to local Pi CLI)
- Run server code in the preview (Sandpack is client-only; `app/api/*` skipped)
