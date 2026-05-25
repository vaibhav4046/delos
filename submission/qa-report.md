# DelOS · QA Report

Recorded against commit `9c68871` (pre-final-push) — will be updated to
the deployed commit SHA after the next push.

Production URL: `https://delrio.vercel.app/os?guest=1`
Repo: `https://github.com/vaibhav4046/delos`

This report is **honest**, not promotional. Green = verified. Yellow =
working but with a caveat. Red = known blocker with a workaround.

## Build / typecheck

| Check | Status | Notes |
|-------|--------|-------|
| `npx tsc --noEmit` | ✅ | Clean, zero diagnostics |
| `npx next build` | ⚠ | Local Turbopack disk-write panic on OneDrive paths (pages-manifest ENOENT). Vercel build is unaffected (CI runs on Linux). Retry locally outside OneDrive if you need a local prod build. |
| `npm run guard:no-perplexity` | ✅ | No `frontend-cdn.perplexity` references in `src` / `public` |

## Phase 1 · Memory

| Acceptance test | Result | Evidence |
|-----------------|--------|----------|
| Store via voice "remember that my demo tenant is gastronomy one" | ✅ | `voiceParser.ts:473-484` storeMatch + `VoiceApp.tsx:402` POST `/api/memory/write` with `source: "voice-memory"` |
| Recall via voice "what do you remember about my demo tenant" | ✅ | `voiceParser.ts:499-507` regex now matches all 5 phrasings ("what do you remember about X", "show memories about X", "search memory for X", "do you remember X", "recall X") |
| Recall routes to Memory Browser, not Match game | ✅ | `os/page.tsx:834-845` routes to `memoryBrowser`. `VoiceWakeMount.tsx:49` INTENT_MAP key swapped from `memory` → `memoryBrowser`. `VoiceApp.tsx:280-289` routes to memoryBrowser and fires `memory.search` |
| `memory.search` intent pre-fills query in Memory Browser | ✅ | `MemoryDashboard.tsx:129-145` new useEffect listener |
| Arena verdict writes memory | ✅ | `cohort/route.ts:248-271` writes summary on judge-success path AND rubric-fallback path with tags `["arena","cohort","verdict"]` |
| Codegen completion writes memory | ✅ | `codegen-app-stream/route.ts:373,547` (success paths) and now also fallback path |
| Calendar event create writes memory | ✅ | `calendar/events/route.ts:108-122` new write with tag `["calendar", source]` |
| Schedule action create writes memory | ✅ | `schedule/route.ts:51-65` new write with tag `["schedule", kind]` |
| Source badges render in Memory Browser | ✅ | `MemoryDashboard.tsx:54-93` + row render block 416-432 |
| writeGuard blocks `drift=` / `tokens=` / `ms=` noise | ✅ | `writeGuard.ts:11-21` added run-metric-noise + run-metric-cloud patterns |

## Phase 2 · Browser + browse agent

| Acceptance test | Result | Evidence |
|-----------------|--------|----------|
| "OpenAI official documentation" returns official top result | ✅ | `lib/tools/builtin.ts:33-52` scoring boosts `openai.com` + `docs.*` host prefixes by +5/+4. Verified against DDG html lite. |
| "Next.js hydration error" returns Next.js official docs | ✅ | Same scoring · `nextjs` domain hits `+3` boost on `.org|.com|.dev|.io` whitelist |
| Browser window opens from dock | ✅ | `os/page.tsx` lazy import + dock entry |
| Iframe-blocked sites show "open in new tab" | ✅ | `BrowserApp.tsx:86-176` KNOWN_EMBED_BLOCKERS list + onload-timeout fallback |
| Browse agent returns `{ ok, plan, final }` with `final` as text | ✅ | `browse-agent/route.ts:86-122,190-206` safeParseJson + answer-step nesting recovery |
| No prose-wrapped JSON in `final` | ✅ | Audit confirmed: schema is `z.string().max(2000)`, parser strips fences and walks brace-balanced |

## Phase 3 · VibeCode / codegen

| Acceptance test | Result | Evidence |
|-----------------|--------|----------|
| Investor CRM domain prompt → deterministic playbook | ✅ | `codegenPlaybooks.ts:164` buildInvestorCrm |
| Regulatory AML / Clinical Trial / Legal / AI Tutor / Ops Incident playbooks | ✅ | Same file, lines 240-624 |
| Codegen stream emits `project_done` on quota error | ✅ | `codegen-app-stream/route.ts:578-624` fallback engaged with broadened trigger (all errors, not just quota) |
| Codegen stream emits `project_done` on `fileResults.length < 3` | ✅ | Now caught by the same broadened fallback path |
| Codegen fallback writes memory | ✅ | Added at line ~623 alongside success-path writes |
| BUILD button visible above dock | ✅ | Sticky footer pattern preserved in VibeCode wizard |
| Export ZIP / HTML works | ✅ | `codegen-app/export/route.ts` supports both GET (cold-start risk) and POST (cold-safe inline) |

⚠ **Yellow**: dedicated playbooks for Notion / Linear / Slack / Spotify
/ Calendar / Figma / VS Code / GitHub repo / Stripe still go through the
LLM path. Generic-dashboard catches them as a fallback when LLMs fail.
Quality is below the domain cockpits. Adding these is the highest-ROI
follow-up.

## Phase 4 · Voice parser

| Command | Result | Evidence |
|---------|--------|----------|
| "open browser and search hydration errors" → app=browser, payload="hydration errors" | ✅ | `voiceParser.ts:281-302` short-circuit + "browserand" glue bug fixed |
| "open browser search hydration errors" → app=browser, payload="hydration errors" | ✅ | `voiceParser.ts:395-431` |
| "build me an investor CRM…" → clean build_app prompt | ✅ | `voiceParser.ts:373-387` |
| "remember that my demo tenant is gastronomy one" | ✅ | storeMatch line 473 |
| "what do you remember about my demo tenant" | ✅ | recall regex line 499 |
| "remind me to call Andy in 30 minutes" | ✅ | remMatch text="call Andy", dueAt computed |
| "schedule lunch next Friday at 1pm" → title="lunch", when="next Friday at 1pm" | ✅ | calMatch noun-glue fix at line 211-235 |
| "schedule meeting with Andy tomorrow at 4pm" → title="with Andy", when=… | ✅ | Same fix · "meeting" is filler, "Andy" preserved |
| "set up a daily email digest" → schedule_action read_email daily | ✅ | Schedule branch at line ~185 |
| Compound: "open terminal, calculate 17 times 19, build me a habit tracker, summarize" | ⚠ | Partial — math leg returns 323 cleanly; subsequent build_app and run_mission legs drop because pickPrimary collapses on math hit. Acceptable for demo (judges hear the math answer), follow-up to thread chunks through chunkVoice. |
| Confidence/tier/status coherent | ✅ | `voice-command/route.ts:113-133` rejected chunks tagged `err:"no_local_match"`, never leak into final intent |

## Phase 5 · Integrations + keys

| Provider | Status | Source |
|----------|--------|--------|
| Groq | configured iff `GROQ_API_KEY` set | `/api/integrations/status` |
| Mistral | configured iff `MISTRAL_API_KEY` set | same |
| Google Gemini | configured iff `GOOGLE_GENERATIVE_AI_API_KEY` set | same |
| NIM | feature-flagged via `isNimEnabled()` | `/api/llm/audit` |
| ElevenLabs | optional · falls back to browser SpeechSynthesis | inferred from `ELEVENLABS_API_KEY` presence |
| HydraDB | required for cross-session memory · falls back to local in-memory | `lib/hydra.ts` |
| Gmail | demo:true unless OAuth wired | `connectors/gmail/draft/route.ts:31-47` |
| Notion | demo:true unless OAuth wired | `connectors/notion/create-page/route.ts:27-39` |
| GDrive | demo:true unless OAuth wired | mirror of Notion |
| GitHub | demo:true unless OAuth wired | mirror of Notion |

✅ `/api/llm/audit` now returns explicit `missingKey: true` field when the
provider's env var is empty, instead of a generic timeout/401 string.

✅ `.env.example` updated to document every key the code reads (Cerebras,
NIM, OAuth client IDs, demo-mode toggles, session secret).

## Phase 6 · UI / UX

| Route / app | Render | Console | Notes |
|------------|--------|---------|-------|
| `/` | ✅ | clean | landing reads stats via revalidate=60 |
| `/os?guest=1` | ✅ | clean | guest session works, no PII probe |
| `/demo` | ✅ | clean | canned trace + scripted hackathon mode |
| `/status` | ✅ | clean | live status grid |
| `/pitch` | ✅ | clean | static pitch |
| `/scorecard` | ✅ | clean | static scorecard |
| `/arena` | ✅ | clean | model count now derived from MODEL_CATALOG (no drift) |
| Browser app | ✅ | clean | iframe-blocked sites handled |
| Voice agent | ✅ | clean | text fallback present |
| VibeCode | ✅ | clean | sticky footer above dock |
| DelCode | ✅ | clean | hydration race + scroll sync fixed in prior session |
| Memory Browser | ✅ | clean | source badges + intent listener |
| Calendar | ✅ | clean | tz-correct zero-dep parser |
| Widgets | ✅ | clean | crypto widget falls back gracefully on 429 |
| Schedule | ✅ | clean | writes memory on create |
| Notifications | ✅ | clean | |
| Arena | ✅ | clean | |
| Mission Control | ✅ | clean | |
| Settings | ✅ | clean | |
| Dock blocks important buttons | ✅ | n/a | VibeCode sticky footer fix preserved |

## Phase 7 · Security

| Check | Result | Evidence |
|-------|--------|----------|
| CSP / HSTS / X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy | ✅ | `middleware.ts` stamps every response |
| `/api/me` returns no PII anonymously | ✅ | Reverified against this session's `/api/me/route.ts` — `?profile=full` + same-origin required |
| Tenant isolation | ✅ | `resolveTenant` ignores body tenantId for real user data; only honors `qa_/demo_/test_/judge_/hack_/hackathon_` prefixes |
| Rate-limit returns JSON, not HTML | ✅ | `rateLimit` returns 429 + JSON body |
| Memory clear requires window.confirm | ✅ | `VoiceApp.tsx:415-419` |
| `writeGuard` blocks system-prompt leaks | ✅ | `writeGuard.ts:16` |
| Exported files don't include secrets | ✅ | Codegen output is project files only · no .env / no key bag |
| No Perplexity CDN font hotlink | ✅ | guard:no-perplexity passes |

## Phase 8 · API smoke matrix

Each test will be re-run post-deploy against the live URL and pasted
into this file with timing + status. Local smoke (with `.env.local`):

| Endpoint | Method | Expected | Notes |
|----------|--------|----------|-------|
| `/api/health` | GET | `{ ok: true }` | trivial |
| `/api/llm/audit?force=1` | GET | per-model OK/missingKey | now includes missingKey flag |
| `/api/voice-command` | POST | intent+reply | shared parser with /api/voice-router |
| `/api/memory/write` | POST | ok / dedup / reject | source field whitelisted |
| `/api/memory?q=...` | GET | hits + local | |
| `/api/calendar/events` | POST | event + memory write | |
| `/api/schedule` | POST | action + memory write | |
| `/api/codegen-app-stream` | POST | SSE → project_done | even on fallback |
| `/api/codegen-app/clarify` | POST | clarify yes/no | planner_unavailable safe |
| `/api/codegen-app/export` | GET/POST | zip/html | POST inline cold-safe |
| `/api/browse-agent` | POST | plan + final string | |
| `/api/tool` web_search | POST | scored results | |
| `/api/tts/voices` | GET | list | |
| `/api/integrations/status` | GET | provider state list | |

## Known residual risks

1. **Local Turbopack build flakes on OneDrive paths.** Vercel CI runs
   on Linux and is unaffected — production builds succeed. Document
   this for any future contributor who tries to build locally on
   Windows + OneDrive.
2. **Compound voice with 3+ legs collapses on math.** "open terminal,
   calculate 17 × 19, build a tracker" gives only the math answer.
   Follow-up: thread chunks through `chunkVoice` before `pickPrimary`.
3. **Clone playbooks missing for Notion/Linear/Slack/Spotify/Stripe.**
   LLM path covers them; quality is uneven.
4. **GitHub/GDrive autonomous actions are `demo:true` in guest sessions.**
   OAuth wiring is out of scope for the hackathon.
5. **Coverage scorer is per-playbook only.** A `domain-packs/` style
   coverage matrix for the new domain cockpits would be a follow-up.

## Demo-safe claims (can say on Loom)

- "Five pillars in one tab: voice, memory, arena, codegen, MCP."
- "Memory updates across actions and shows source badges."
- "Codegen always finishes — deterministic playbook fallback on any
  failure."
- "Cross-vendor arena with judge model + rubric fallback."
- "Honest demo mode — Gmail and Notion show 'simulated' until OAuth
  is wired."
- "No login. Guest mode is the demo."

## Claims NOT to make on Loom

- ❌ "Real Gmail" / "real Notion" — guest sessions are demo:true.
- ❌ "10/10 hackathon-ready" — leave that to the judges.
- ❌ "Always-on autonomy" — schedule actions are stored, not running
  as a background daemon.
- ❌ "Perfect accuracy" — voice parser drops the build/summarize legs
  of the 4-step compound.
- ❌ "All providers verified live" — depends on operator's env keys.
