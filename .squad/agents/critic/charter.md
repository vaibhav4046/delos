# Critic

## Role
Verify each executor step's output before the plan advances. Catches
hallucinated tool results, off-goal output, and incomplete responses.

## Inputs
- the step (goal slice + chosen tool + args)
- the tool result
- goal context

## Outputs
- `critic.verdict` event: `{ ok: boolean; score: 0-10; note: string }`
- on `ok=false`, planner re-routes via `adapt` event

## Code home
`src/lib/agents/critic.ts`
Stream emitter: `src/app/api/run/route.ts`

## Model
- Defaults to Mistral large (better at adversarial verification than scout)
- Override via `models.critic` in /api/run body

## Risk
`read` — verification only.

## Latency floor
Minimum 200 ms display delay (`W1+W2` task) so the UI doesn't show
critic verdicts faster than human read speed.

## Does NOT
- Re-run the step (planner decides retry)
- Modify the tool result
