# DelOS

Browser operating system for AI agents. Built for the Agents Under
Pressure HydraDB hackathon, May 2026.

**Live URL:** https://delrio.vercel.app
**Open the OS:** https://delrio.vercel.app/os?guest=1
**Sixty second judge demo:** https://delrio.vercel.app/os?guest=1&demo=judge
**Repository:** https://github.com/vaibhav4046/delos
**Five minute Loom script:** [`submission/loom-script-5min.md`](submission/loom-script-5min.md)
**Pitch deck:** [`submission/pitch-deck.md`](submission/pitch-deck.md)
**QA report:** [`submission/qa-report.md`](submission/qa-report.md)
**Demo checklist:** [`submission/demo-checklist.md`](submission/demo-checklist.md)
**Hackathon form draft:** [`submission/aivalley-form-draft.md`](submission/aivalley-form-draft.md)
**Win path status:** [`submission/WIN_PATH_STATUS.md`](submission/WIN_PATH_STATUS.md)

## What runs in one tab

| Pillar | Where | What you see |
|---|---|---|
| Memory | Memory Browser, Memory Dashboard | Cross action recall with typed source badges. Voice memory, codegen, arena, calendar, schedule all write to the same store. |
| Voice | Voice Agent, Del Assistant | Whisper for speech to text. Twenty plus parsed intents. Build apps, draft Gmail, create Notion pages, set reminders, schedule actions, recall memory, open browser, race models. |
| Codegen | VibeCode and DelCode | Domain cockpits for Investor CRM, Regulatory AML, Clinical Trial, Legal Redline, Ops Incident, AI Tutor. SSE per file streaming into a real IDE pane. Export zip or single file HTML. |
| Arena | Arena page | Five models from three providers race a prompt. Judge model scores them. Winner persists to memory with an arena tag. |
| MCP | Del Assistant | Gmail draft, Notion create page, GitHub list repos, GDrive list files. Demo mode returns simulated previews when no OAuth is configured. |

## How the judge demo works

Press the JUDGE DEMO pill in the top bar of the OS or click the Demo
link on the homepage. A narration card appears above the dock. It
shows the step number, a short eyebrow label, a one sentence
explanation of what just fired, and a live countdown. The whole script
fits in sixty seconds. Press Escape to cancel any time.

Five steps:

1. **Gmail.** Del Assistant writes a real Gmail draft. Demo preview when
   no Google account is connected.
2. **Notion.** Same chat creates a Notion page titled DelOS Hackathon
   Demo Recap.
3. **GitHub.** The assistant lists my actual GitHub repositories via
   the public GitHub API.
4. **VibeCode.** The Investor CRM cockpit builds live. Files land into
   DelCode on the right.
5. **Memory.** Memory Browser opens with the recall already prefilled.
   Every previous step is visible with its source badge.

## Architecture in plain words

The browser holds a Next sixteen app with React nineteen. The shell is
a Framer Motion window manager wrapping pixel art panels. Forty plus
API routes power the OS. HydraDB stores graph plus vector memory. A
multi provider LLM cascade (Cerebras, Groq, Mistral, Gemini, NIM,
Bytez) keeps responses moving when any one quota trips.

## Tech stack

Next sixteen with Turbopack. React nineteen. TypeScript. Tailwind v4.
Framer Motion. Lucide icons. Zod. HydraDB SDK. Vercel AI SDK v6.
JSZip for project export. ElevenLabs and Whisper for voice. Cockatiel
for retries.

Multi-agent orchestration that survives real-world chaos — and a browser-OS where agents *build the apps live*. Four pillars, retro-arcade UI, one job: keep agents moving when tools fail, goals shift, context floods, and the user interrupts.

## What is shipped

| Pillar | Surface | Where in the OS |
|--------|---------|-----------------|
| **Memory** · save state | HydraDB graph + vector + 72h-recency lexical fallback, write-guard against pollution | Memory Browser app · `/memory` route |
| **Tools** · power-ups | Typed registry, MCP shapes, sibling fallback on failure, 6 domain playbooks with coverage scoring | App Builder · DelCode · Marketplace |
| **Recovery** · 1-up | Provider cascade (Cerebras → Groq → DeepSeek → OpenRouter → Gemini → Together → Mistral), cockatiel retry + circuit breakers, critic-driven replan on drift > 0.3 | Chaos lab · `/play` |
| **Adaptation** · warp zone | Multi-intent voice chunker, mid-stream STEER endpoint, goal-drift detection, context-flood compression | Voice agent · Terminal |

11 of 11 acceptance gates passing — see `scripts/judge-regression.mjs`.

## Project docs

- `docs/ARCHITECTURE.md` — agent loop state machine, component map, mermaid diagrams
- `docs/SCHEMA.md` — HydraDB collections, API surface, run-event union, risk tiers
- `docs/SECURITY.md` — threat model, defense layers, write-guard, approval-tap policy
- `docs/DEMO_SCRIPT.md` — deterministic 60-second judge demo specification
- `outputs/LOOM_SCRIPT.md` — beat-by-beat 4–5 min recording script
- `outputs/HACKATHON_FORM.md` — paste-ready submission answers
- `outputs/SETUP.md` — env var checklist + where to get each key
- `outputs/DEPLOY.md` — full operator runbook for Vercel + GitHub

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
