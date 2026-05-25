# DelOS · Hackathon Pitch Deck

A markdown deck. Open `pitch-deck.html` in a browser for the rendered
slide view (same source, paged with `---`). 10 slides.

---

## Slide 1 — Title

# DelOS
### a browser OS for autonomous agents

Voice. Memory. Model arena. Codegen. One link.

`https://delrio.vercel.app/os?guest=1`

48 hours · solo build · Agents Under Pressure · HydraDB

---

## Slide 2 — The problem

Today's AI tools are siloed.

- ChatGPT, Claude, Perplexity — different tabs, different memories, no
  shared state.
- "Autonomous agent" demos are scripted videos, not real software.
- Voice assistants can't *build*. They schedule meetings and read
  weather.
- Hackathon judges scroll past polished landing pages. They want to
  *use* the thing.

There is no surface where memory, voice, code generation, and a model
race all live in one tab — and survive a real demo.

---

## Slide 3 — The solution

**DelOS** is a browser OS with five real pillars working together:

1. **Voice agent** that parses 20+ intents and *builds* apps from
   spoken prompts.
2. **HydraDB memory** that updates across every action — voice store,
   arena verdict, codegen completion, calendar event, schedule action.
3. **Arena / cohort** — 5 models from 3 providers race the same
   prompt, a judge model scores, the winner gets pinned.
4. **VibeCode + DelCode** — domain-aware codegen with deterministic
   fallback. Always finishes. ZIP / HTML export.
5. **Autonomous MCP** — Gmail, Notion, GitHub, GDrive. Honest demo
   mode when OAuth isn't configured.

All in one tab. No login. Guest mode is the demo.

---

## Slide 4 — Live workflow

The 5-minute judge demo:

```
Voice → Build → Memory → Arena → Export
```

1. Voice: "Build me an investor CRM with warm-intro graph."
2. VibeCode opens, codegen streams, DelCode shows files landing.
3. Voice: "Remember that my demo tenant is gastronomy one."
4. Voice: "What do you remember about my demo tenant?"
5. Memory Browser opens, recall hits with VOICE MEMORY badge.
6. Arena races 5 models, winner persists to memory.
7. Export project as ZIP or single-file HTML.

One scripted state-machine button in the top bar drives the whole tour
for judges: `▶ JUDGE DEMO`.

---

## Slide 5 — Architecture

```
 Browser (Next 16 · Turbopack · React 19)
 ┌─────────────────────────────────────────────────────┐
 │  Pixel OS shell · framer-motion window manager      │
 │  ├─ Voice Agent · Whisper Large v3 STT              │
 │  ├─ VibeCode · split-view DelCode preview           │
 │  ├─ Arena · SSE-streamed cohort race                │
 │  ├─ Memory Browser · source-tag filtering           │
 │  └─ Del Assistant · MCP autonomous patterns         │
 └────────────────────┬────────────────────────────────┘
                      │
 Next.js API routes (40+ endpoints)
 ┌────────────────────┴────────────────────────────────┐
 │  /api/voice-command · shared parser                  │
 │  /api/cohort · SSE arena race + memory write         │
 │  /api/codegen-app-stream · per-file SSE + fallback   │
 │  /api/memory · HydraDB + local fallback              │
 │  /api/connectors/{gmail,notion,github,gdrive}        │
 └────────────────────┬────────────────────────────────┘
                      │
 HydraDB graph + vector  ·  Multi-provider LLM cascade
 (Groq → Mistral → Gemini → Cerebras → NIM)
```

---

## Slide 6 — AI / model strategy

| Tier | Provider | Why |
|------|----------|-----|
| Hot path | Mistral Small | Cheap, fast, reliable for planner/exec |
| Cohort | Groq + Mistral + Gemini | Cross-vendor variance for arena |
| Codegen | Cerebras / Groq race | First-token latency wins |
| Fallback | Deterministic playbooks | Always finishes when LLMs fail |
| Optional | NIM Nemotron-49B | God-mode + verifier pass |

Failure isn't silent. Quota? Engage playbook. 401? `missing_key` flag.
Wrong winner? Rubric rescore. Every error path goes somewhere useful.

---

## Slide 7 — HydraDB · the memory differentiator

Every meaningful action writes a memory with a typed source tag:

| Source | Tag | Example |
|--------|-----|---------|
| Voice "remember that" | `voice-memory` | User fact · my demo tenant is gastronomy one |
| Arena race | `arena` | Winner: Mistral Large at 1.2s · disagreement 0.18 |
| Codegen completion | `codegen` | Investor CRM (12 files) · domain matched |
| Calendar event | `calendar` | Lunch on 2026-06-05 with Andy |
| Schedule action | `schedule` | Daily email digest @ 09:00 |

Memory Browser renders the badges so recall is *visible*. You don't
just remember — you remember *why* you remember.

The `writeGuard` blocks noisy run-summary text (drift/token/ms
metrics) from polluting the recall surface.

---

## Slide 8 — Demo proof · QA results

See `submission/qa-report.md` for the full grid.

Green:
- Voice → build → DelCode preview · works end-to-end
- Arena race with cross-vendor models · writes memory
- Memory recall via voice → Memory Browser pre-fills query
- Codegen fallback engaged on every error class, not just quota
- Browser search returns relevant top result for 4/4 brutal-QA prompts
- CSP / HSTS / X-Frame-Options stamped on every response
- PII gate on `/api/me` — email only with `?profile=full` + same-origin

Yellow (honest):
- Gmail / Notion run in `demo:true` mode without OAuth — clearly
  labeled in UI and response payloads
- Clone templates for Notion / Slack / Spotify / Stripe / etc still
  route through the LLM path (no dedicated playbook) — generic
  fallback catches them but quality is below the cockpit playbooks

Red:
- (None blocking — see qa-report.md for the full list and demo-safe
  workarounds)

---

## Slide 9 — Market · who needs this

DelOS is positioned as the **agent operating layer** for the next
wave of vertical AI:

- **AI tutors** with spaced repetition + mastery tracking
- **Regulatory cockpits** (AML, KYC, SAR drafting)
- **Clinical-trial protocol managers** with adverse-event logs
- **Investor CRMs** with warm-intro graphs
- **Legal redline benches** with clause inventory
- **Ops incident command** with sev pills + status-page drafts

These are the templates that lead the VibeCode gallery — domain
cockpits, not platform clones. Each one is a wedge for a real
buyer in a real industry.

---

## Slide 10 — Closing

DelOS is the demo I would want to see if I were a hackathon judge.

- Real software, not a video.
- Honest about what's simulated.
- Every pillar testable in one tab.
- Built solo in 48 hours.

If this wins, I keep building. If it doesn't, the open-source repo at
`github.com/vaibhav4046/delos` is the same code — fork it, run it,
hate-PR it. Either way the platform exists.

`delrio.vercel.app/os?guest=1`

Thank you.
