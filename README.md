# Del Rio — agents that flow under pressure

Built for **Agents Under Pressure** (HydraDB 48h hackathon, May 2026).

Multi-agent orchestration that survives real-world chaos — and a browser-OS (**DelOS**) where agents *build the apps live*. Four pillars, retro-arcade UI, one job: keep agents moving when tools fail, goals shift, context floods, and the user interrupts.

## DelOS — the headline demo

Visit `/os` for a full-screen browser-OS:

- **Boot sequence** → pixel-art desktop with grid, dock, taskbar, clock
- **App Builder** → describe an app in natural language → planner LLM generates a JSON spec → Zod validates → renders as a draggable window with reactive state and tool/agent actions
- **Terminal** → live SSE trace of the full Del Rio orchestrator (planner → executor → critic → recovery → answer) running inside a window
- **Mission Control** → recent runs pulled from HydraDB save-state
- **Notes** → simple persistent notes
- **About** → the four power-ups at a glance

Apps spawn with framer-motion spring animations. Toasts coin-pop in on tool events. Drag-to-reorder windows with z-index focus. HydraDB stamps each agent-built app so it's recoverable across sessions.

### How the App Builder pipeline works

```
user prompt
   │
   ▼
POST /api/build-app
   │
   ├── planner LLM (Groq gpt-oss-120b) generates JSON
   ├── Zod schema validation (rejects malformed specs)
   └── HydraDB save-state ("Built DelOS app …")
       │
       ▼
{ spec } returned to client
   │
   ▼
spawnSpecWindow() mounts <AppRuntime spec={...} />
   │
   ▼
  AppRuntime walks the spec tree → renders text/buttons/inputs/lists
  buttons dispatch actions:
    set / toggle / inc / push / clear / notify / close
    tool   → POST /api/tool   (runs a registered tool)
    agent  → POST /api/quick-agent (one-shot LLM)
```

No code-eval. Every node and action is a typed primitive that maps to a known React renderer or HTTP route.

## The four power-ups

| Pillar | Retro name | What it does |
| --- | --- | --- |
| Memory | **Save State** | Long-term recall via HydraDB graph + vectors + lexical hybrid. Local fallback when HydraDB is still indexing. |
| Tools | **Power-Ups** | Typed registry with capability tags. Z-schema-described to the executor LLM. Sibling tools picked as fallbacks on failure. |
| Recovery | **1-Up** | Cockatiel retry + circuit breaker. Critic agent triggers replans on drift. Self-correcting prompts on tool failure. |
| Adaptation | **Warp Zone** | Goal-drift detection via critic scoring. User interrupts mid-stream rebuild the plan. Context flood compressed at the boundary. |

## Stack

- **Next.js 16** App Router · React 19 · Tailwind v4
- **HydraDB** (`@hydradb/sdk`) — sponsor memory layer
- **Groq** (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`) — planner + executor
- **Mistral** (`mistral-large-latest`) — critic
- **Gemini** (`gemini-2.5-flash`) — critic fallback
- **Vercel AI SDK v6** — `generateText` + custom JSON parser (provider-agnostic)
- **Cockatiel** — retry + circuit breakers
- **Zod** v4 — typed tool schemas
- Pixel UI: **Pixelify Sans** + **Inter** + **JetBrains Mono** + custom Tailwind tokens

## Run it

```bash
pnpm install
cp .env.example .env.local   # fill in keys
node ./node_modules/next/dist/bin/next dev -p 3000
```

Hit [http://localhost:3000](http://localhost:3000).

> **Why bypass `pnpm dev`?** A scaffold artifact in `pnpm-workspace.yaml` makes `pnpm` choke on dep-status checks. Running the Next binary directly skips that and saves a re-debug.

## Demo flow (90 seconds)

1. **Landing** — `/` — click **★ Launch DelOS**.
2. **DelOS boots** — pixel boot sequence → desktop with logo + dock.
3. **App Builder** opens → leave the default "stopwatch" prompt → **BUILD APP**. ~5-15s later a Stopwatch window springs in with Start/Stop/Reset/Tick.
4. **Terminal** opens → type a mission → watch the trace stream live: planner → executor → tool → critic drift score → answer.
5. **Build a second app** — pick "haiku generator", click **BUILD APP** → an app appears that calls the agent inline when you submit a topic.
6. **Memory** (`/memory` or Mission Control) — every agent run + every app you built is in HydraDB save-state.
7. **Chaos route** (`/play`) — toggle Tool flake + Context flood + User interrupt to see Recovery + Warp-Zone live.
8. **PWA + Chrome ext** — `chrome-ext/` loaded unpacked = side-panel companion. Install the PWA from Chrome menu = same UI as iOS/Android home-screen app.

## Project layout

```
src/
  app/
    page.tsx            # landing
    os/page.tsx         # DelOS browser-OS (headline demo)
    play/page.tsx       # interactive chaos demo
    memory/page.tsx     # save-state browser
    api/
      run/route.ts       # SSE streaming agent runs
      memory/route.ts    # recall + local fallback
      build-app/route.ts # planner generates DelOS app spec
      tool/route.ts      # single tool call (used by AppRuntime)
      quick-agent/route.ts # one-shot LLM (used by AppRuntime)
  components/
    Logo.tsx
    AgentLog.tsx
    ChaosControls.tsx
    RunMetrics.tsx
    os/
      Boot.tsx          # pixel boot sequence
      Window.tsx        # draggable framer-motion window chrome
      Toast.tsx         # coin-pop toast stack
      AppRuntime.tsx    # safe renderer for agent-generated app specs
      systemApps.tsx    # Terminal / Mission Control / Notes / App Builder / About
  lib/
    agents/
      planner.ts        # 2-5 step plan
      executor.ts       # picks tool + final answer
      critic.ts         # drift score + verdict
      appBuilder.ts     # planner → AppSpec for DelOS
      jsonGen.ts        # provider-agnostic JSON generation
    tools/
      registry.ts       # typed registry with tags + fallbacks
      builtin.ts        # web_search, http_fetch, calc, notes, wait, summarize
    appSpec.ts          # Zod schema + types for AppSpec
    hydra.ts            # HydraDB SDK + retry + local fallback
    llm.ts              # model router
    resilience.ts       # cockatiel policies
    orchestrator.ts     # main agent loop with chaos hooks
chrome-ext/             # MV3 side-panel companion
public/
  icon.svg              # pixel ?-brick logo
  manifest.webmanifest  # PWA manifest
```

## What makes Del Rio survive chaos

**Recovery is wired at three layers:**

1. **LLM layer** — `generateJson` retries 3× with a stricter prompt on each failure (provider quirks like Groq's "tool choice none" error are recovered transparently).
2. **Tool layer** — cockatiel wraps every tool call with retry + circuit breaker. On open circuit or persistent failure, the orchestrator queries the registry for a sibling tool with overlapping tags and tries that.
3. **Plan layer** — the critic agent scores `driftScore` after every step. Above threshold or two consecutive tool failures triggers a full replan with prior-attempt context baked in. Bounded to 2 replans per run so we never spin forever.

**Memory is wired at two layers:**

1. **HydraDB** — graph + vectors + lexical recall in one call. Tenant provisioning is async (1-2 min); the SDK call is wrapped in `withRetry` that backs off on `TENANT_NOT_FOUND` until ready.
2. **Local fallback** — every memory write also persists to a `globalThis`-backed array, so the UI never shows an empty Save State while HydraDB is still indexing.

**Adaptation is wired at three layers:**

1. **Goal drift** — critic compares current plan vs original goal each step.
2. **Mid-stream interrupt** — `interrupt: { afterSteps, newGoal }` swaps the objective and forces a planner reset.
3. **Tool discovery** — failure on `web_search` falls through to `http_fetch` (same `research`/`web` tags).

## Security note

`.env.local` keys are gitignored. Hackathon keys must be rotated after the demo regardless — the values landed in a chat transcript during the build.

## Credits

Built solo in 48h by Vaibhav. Logo metaphor: pixel `?`-brick. Brand inspired by *del rio* — *"of the river"* — agents that flow around blockers instead of crashing into them.
