# Executor

## Role
Carry out planner's steps. Calls tools (local + MCP), handles failures,
streams `tool_call` / `tool_result` events.

## Inputs
- `steps[]` from planner
- registered tools from `src/lib/agents/tools.ts` + MCP servers in
  `src/lib/useMcpServers.ts`

## Outputs
- per-step `tool_call` + `tool_result` events on the run stream
- on failure: emits `recover` event handing off to recovery flow

## Code home
`src/lib/agents/executor.ts` (function `executeStep`)
Tool registry: `src/lib/agents/tools.ts`

## Model
Same role-keyed model as planner; defaults to scout-17b.

## Risk
Depends on tool — `web_search` is `read`, `notes_append` is `draft`,
`deploy` is `external`. Tool-level risk is set in `src/lib/skillManifest.ts`
and ApprovalGate pauses before external/money/destructive calls.

## Does NOT
- Decide the next step (planner adapts via `adapt` event)
- Mark steps "verified" (critic's job)
