# DelOS — 60-second deterministic judge demo

Triggered by `?demo=1` on the OS route, by typing `:demo` in the Terminal, or by clicking the `★ DEMO` pill in the OS top bar.

State persistence: `localStorage:delos:demo:step` so an accidental refresh resumes where it stopped.

## Sequence

| # | Action | Visible | Target latency |
|---|--------|---------|----------------|
| 0 | Open Terminal | Terminal window with neofetch splash | 200ms |
| 1 | Type `ai compare graph DBs vs vector DBs for AI agent memory in 3 bullets` | Streaming bullets appear | 2.5s |
| 2 | Toast: "Chaos: tool outage" → flip `Tool Outage` ON | Red toggle, red toast | 200ms |
| 3 | Re-run same prompt; primary provider fails, sibling fallback succeeds | Trace shows fallback | 3.5s |
| 4 | Open VibeCode, type `Build an Investor CRM with commitment score, warm intro graph, partners, dilution preview` | Playbook stream, coverage 100% | 3s |
| 5 | Open Memory; query `what did we decide about graph vs vector?` | One clean fact card with timestamp | 600ms |
| 6 | Open Cohort with `?godMode=1`; ask `Will SBLC requirements change for European fintechs in 2026?` | 5 models race, disagreement 38%, verifier note | 5s |
| 7 | Done | Top bar shows ag=5, req≈40, tok≈40k, cost≈$0.012 | — |

Total wall time target: 60 seconds.

## Implementation note

`JudgeDemoDirector.tsx` lives at `src/app/(os)/components/JudgeDemoDirector.tsx`. It pushes events into the same `runtime` store the OS already uses; no special demo-only render path. Stop button + Replay button always visible.

If you are reading this and the demo director is not yet implemented, ship it last — every other surface above must work standalone first.

## Failure modes to handle

- Provider rate-limited mid-demo → toast "Provider hot, using sibling" and continue.
- Network drops → autoplay halts, sticky note appears "Resume demo? [▶]".
- LocalStorage cleared → restart from step 0, no error.
- User clicks away → director keeps running in background, focused window resumes when re-clicked.

## What NOT to do

- Don't autoplay on the marketing landing page (it's a judge-only path).
- Don't show animations the user has disabled via `prefers-reduced-motion`.
- Don't simulate any failure mode that isn't actually wired up to the real chaos toggle.
