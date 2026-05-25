# WIN_PATH status · 6-fix lift to 9.7

Mapped against the original brutal-QA report's WIN_PATH (`+4.2` lift).
Updated 2026-05-25 after commit `c242f29`.

| # | Fix | Status | Where | Notes |
|---|-----|--------|-------|-------|
| W1 | Codegen tier default = `prototype` | ✅ DONE | `systemApps.tsx:898` | Was already prototype-default; production opt-in via wizard |
| W2 | Auto-seed memory for anon-ip tenants | ⚠ PARTIAL | `memory/route.ts:60-94` | Seed runs for demo/anon prefixes; verify via `?tenantId=anon_*` |
| W3 | Weather rejects unknown city names | ⏳ NOT YET | `weather/route.ts` | Quick fix · add confidence gate on geocode |
| W4 | Notification badge wired or removed | ✅ DONE | `os/page.tsx:1239-1248` | Click opens NotificationCenter window |
| W5 | Gmail / Notion OAuth demo simulator | ✅ DONE | `connectors/{gmail,notion}/*` | `demo:true` envelope when no OAuth |
| W6 | Cohort UI back in launchpad (beta) | ✗ DEFERRED | n/a | Arena page covers the model-race use case; cohort UI intentionally removed |

## Round-2 fixes (post-screenshot)

| # | Fix | Status | Where |
|---|-----|--------|-------|
| R1 | Arena pins to single model, no Bytez fallthrough | ✅ DONE | `quick.ts:20-31`, `cohort/route.ts:131-141` |
| R2 | Run-log "GAME OVER" → "RECOVERED" pill for non-fatal | ✅ DONE | `AgentLog.tsx:151-164` |
| R3 | Dock smaller (40% shorter) + smooth animation | ✅ DONE | `Dock.tsx:71-75,103-114,180-202` |

## Round-1 fixes (still propagating on Vercel as of poll time)

| Fix | Local | Prod |
|-----|-------|------|
| Calendar title "lunch" not "Event" | ✅ verified in source | ⏳ waiting deploy |
| writeGuard blocks drift=/tokens=/ms= noise | ✅ verified in source | ⏳ waiting deploy |
| web_search curated docs for OpenAI/Next.js/etc | ✅ verified in source | ⏳ waiting deploy |
| Memory recall regex broadened to "show memories about X" | ✅ live | ✅ live |
| Memory recall routes to Memory Browser not Match game | ✅ live | ✅ live |
| Cohort verdict writes memory with `arena` source tag | ✅ live | ✅ live |
| Calendar event create writes memory with `calendar` tag | ✅ live | ✅ live |
| Schedule action create writes memory with `schedule` tag | ✅ live | ✅ live |
| MemoryDashboard listens for `memory.search` intent | ✅ live | ✅ live |
| Source-tag badges in Memory Browser | ✅ live | ✅ live |
| `/api/me` PII gate (`?profile=full` + same-origin) | ✅ live | ✅ live |
| Codegen-stream always emits `project_done` on any failure | ✅ live | ⏳ waiting deploy |
| LLM audit `missingKey` flag | ✅ live | ⏳ waiting deploy |
| `.env.example` rewrite with all keys documented | ✅ live | ✅ in repo |

## Three honest red lines

Things judges may break and we should acknowledge:

1. **Compound voice with 3+ legs collapses on math.** "open terminal,
   calculate 17 × 19, build a tracker, summarize" returns only the
   math answer. Won't say "all four legs ran" on stage.

2. **Codegen for trademarked clones (Notion / Linear / Slack / Spotify
   / Stripe).** Quality is uneven — generic-dashboard catches them but
   the cockpits (Investor CRM, AML, Clinical, Legal, Ops Incident, AI
   Tutor) are visibly stronger. Lead with those on the demo.

3. **Real Gmail / Notion / GDrive / GitHub.** Guest-mode runs return
   `demo:true` envelopes with simulated success. UI shows "simulated"
   badge. Don't claim live OAuth on the Loom.

## Hackathon-readiness score (post round 2)

- Code quality: 8.5 / 10 (clean typecheck, build green, no console errors)
- UI polish: 8 / 10 (dock now calm + small; tutorial dismissible)
- Reliability: 8 / 10 (codegen always finishes; arena per-model honest errors)
- Innovation: 9.5 / 10 (browser-OS + voice + memory + arena + codegen + MCP)
- Memory differentiator: 9 / 10 (cross-action writes, source badges, recall pre-fill)
- **Overall: 8.6 / 10** (was 7.5/10 in brutal-QA report)

Lift comes from the round-1 memory + voice + codegen fixes plus the
round-2 dock/arena/error-pill polish. Three remaining red lines are
honest demo-day notes, not blockers.
