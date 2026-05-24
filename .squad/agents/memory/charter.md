# Memory

## Role
Persist run artifacts to HydraDB and surface recall on demand. Bridges
the agent loop to long-term tenant-scoped storage.

## Inputs
- `text` + `metadata` from any agent (writes)
- `query` + `topK` (recalls)
- `tenantId` — derived from session email or `delos_guest`

## Outputs
- `safeAddMemory({tenantId, text, metadata})` → fire-and-forget persist
- `safeRecall({tenantId, query, topK})` → top-K hits
- emits `memory.write` / `memory.recall` events on run stream

## Code home
`src/lib/hydra.ts` (client wrapper + tenant init)
Plus the new HydraDB SDK in `node_modules/@hydradb`

## Security
- Connector tokens (Notion / Gmail / MS / manual paste) are encrypted
  via `src/lib/secrets.ts` (AES-256-GCM) BEFORE persistence. Plaintext
  never lands in `text` — only redacted preview.
- Tenant isolation: every recall + write scoped by `tenantId`. Cross-tenant
  reads impossible.

## Risk
- `read` for recall
- `draft` for persist (per skillManifest)

## Does NOT
- Filter recall results semantically (caller's job)
- Decide what to remember (caller passes text + tags)
