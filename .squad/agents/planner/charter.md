# Planner

## Role
Decompose a user goal into an ordered sequence of executable steps.
Reads identity + memory + intent. Writes a plan.

## Inputs
- `goal: string` — user's request from voice / terminal / API
- `identity` — JarvisOS profile (from `src/lib/useIdentity.ts`)
- `memory recall` — top-K HydraDB hits seeded by goal

## Outputs
- `steps: Array<{ tool: string; args: object; rationale: string }>`
- emitted via `phase: "plan"` event on the run stream

## Code home
`src/lib/agents/planner.ts` (function `planRun`)
Stream consumer: `src/app/api/run/route.ts`

## Model
- Primary: Groq scout-17b (`models.planner` default)
- Per-role override available via `src/lib/useModelOverrides.ts`

## Risk
`read` — planning alone has no side effects.

## Does NOT
- Call tools (executor's job)
- Verify outputs (critic's job)
- Persist anything to HydraDB (memory's job)
