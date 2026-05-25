# DelOS — 4-5 minute Loom video script

Hackathon: Agents Under Pressure (48h HydraDB hackathon).
Target audience: SF Bay Area senior engineer judges.
Recording target: 4:30 minutes (forgiving — 4:00 to 5:00 lands well).
Camera-on for first 15s + last 20s; otherwise screen + voice.

Tone rules: confident, concrete, numbers-first, no buzzwords, no "AI-powered" / "synergy" / "leveraged". Engineer talking to engineers.

Recording set-up before you start:

1. Browser at https://delrio.vercel.app
2. Terminal open as a fallback (only used if Wi-Fi fails)
3. OS shell already loaded — refresh once so first paint is fast
4. Tenant cleared (open dev tools → Application → Local Storage → clear, OR use a fresh incognito window so the Memory Browser starts at zero)
5. Audio at 70%, mic at 80%, screen at 100% zoom

Replace `[your name]` placeholders before shipping.

---

## Beat sheet

### Beat 0 — Cold open · 0:00 to 0:15 · camera on you

**Visual:** your face, dark room, retro CRT vibe if you have one
**Script:**

> "Most AI agent demos look perfect for 30 seconds, then collapse the moment something real happens.
> I built DelOS in 48 hours for the HydraDB hackathon — a browser desktop where the agents survive real-world chaos. Let me show you."

**Cut to screen.** Hand-off line: *"This is the landing page."*

---

### Beat 1 — Landing + "what is this" · 0:15 to 0:45

**Visual:** https://delrio.vercel.app home page
**Script:**

> "DelOS is not an LLM wrapper. It is an operating system substrate.
> Every window — chat, app builder, memory browser, cohort race — runs through the same planner, executor, critic, memory loop.
> Watch the four tracks at the top: Memory, Tools, Recovery, Adaptation. Every demo I do today touches all four. The buttons across the bottom open DelOS. Click DelOS."

**Action:** click `★ DelOS` button.

---

### Beat 2 — OS shell intro · 0:45 to 1:10

**Visual:** OS shell loaded, dock at bottom, Welcome Mat
**Script:**

> "Browser desktop. Dock at the bottom, palette on Cmd+K, right-click for context.
> Top-bar counters are truthful — every LLM call emits X-Tok-In and X-Tok-Out headers and these counters increment from the headers, never optimistically. You'll see them move.
> First app — Memory Browser. This is the save state."

**Action:** click Memory Browser icon in dock (Database icon under TOOLS).

---

### Beat 3 — Memory Browser · 1:10 to 1:45

**Visual:** Memory Browser window open
**Script:**

> "Empty by design. Tenant is a fresh judge tenant. No pollution.
> Watch the live indicator — it polls every 8 seconds. Now I'll seed a real fact through the assistant."

**Action:**
- Open Del Assistant (sidebar or click assistant icon)
- Type: `remember favorite_color = electric blue`
- Send

**Script:**

> "Voice command also works for this; I'm using text to keep audio clean. Notice it pinned cleanly as a User fact, not as a run-summary blob. There's a write-guard at the API that rejects things like 'Run completed for goal …' and 'tone: concise' so the recall surface stays trustworthy."

**Action:** flip back to Memory Browser. Wait for auto-sync (or click refresh). Fact appears.

---

### Beat 4 — VibeCode · domain playbook · 1:45 to 2:35

**Visual:** App Builder window
**Script:**

> "Now the headline feature. App Builder. Most AI builders give you a generic Kanban no matter what you ask. DelOS uses a playbook registry — six domains with required-term coverage scoring. Watch."

**Action:**
- Open App Builder
- Type prompt: `Investor CRM with commitment score, warm intro graph, partners, risk flags, diligence checklist, portfolio board`
- Submit

**Script:**

> "Server detects the investor-crm domain, streams the playbook deterministically — no LLM call, sub-three seconds — and the coverage scorer verifies every required term landed. CommitmentScoreCard, WarmIntroGraph, RiskFlags, DiligenceChecklist, PartnerFollowUp — all present.
> If a slow-path LLM build ever dropped below eighty-five percent coverage, the route appends a Coverage Patch component that names the missing surfaces."

**Action:** open the materialized app, scroll briefly to show real domain UI (real LP names, commitment scores, risk flags with severity colors).

---

### Beat 5 — Cohort race + recovery · 2:35 to 3:20

**Visual:** Cohort window (or Arena if cohort is renamed)
**Script:**

> "Cohort race. Default mode runs three models — Mistral small, Gemini 2.5 flash, Groq gpt-oss-20b — with a judge picking the merge. God Mode runs five plus a verifier at temperature zero. The verifier exists because models confabulate, and the judge alone is not enough."

**Action:** start a cohort with a deliberately uncertain prompt:
- Type: `Will SBLC requirements change for European fintechs in 2027? Two sentences. If unsure say so.`

**Script:**

> "Models race in parallel. Each row shows latency, tokens, confidence. The verifier appends a fact-check note. If the cohort disagreement score crosses thirty percent, the verifier marks the answer as needs-citation rather than rubber-stamping it."

**Action while waiting:** mention if anything weird happens —

> "If a provider rate-limits mid-call you'll see a sibling fallback in the trace. The agent does not give up — it picks the next model in the cascade."

---

### Beat 6 — Chaos demo · 3:20 to 3:55

**Visual:** Play route or in-OS Chaos lab
**Script:**

> "Recovery track. Open the chaos lab."

**Action:** navigate to `/play` in a new tab OR hit the chaos toggle in the OS top bar.

**Script:**

> "Tool outage toggle. I'm forcing a provider failure mid-run. Watch the trace."

**Action:** flip Tool Outage to ON. Re-run a research command.

**Script:**

> "Cockatiel retry, then sibling fallback to the next provider, then critic accepts because the answer matches the intent. Drift score zero point oh-eight. The chain did not collapse. This is the difference between a demo and software."

---

### Beat 7 — Voice compound command · 3:55 to 4:20

**Visual:** Voice agent or terminal
**Script:**

> "Last track — adaptation. Compound voice commands chain across the OS."

**Action:** click Voice agent. Speak (or type if voice is flaky):
- `Open terminal, calculate seventeen times nineteen, build me a habit tracker, then summarize in two bullets.`

**Script:**

> "Chunker splits on conjunctions and verb boundaries. Four chunks become four intents. Each intent fans out to its handler, each one toasts when it starts and finishes. The old version of this agent silently dropped every verb after the first one."

---

### Beat 8 — Close · 4:20 to 4:45 · back to camera

**Visual:** your face again
**Script:**

> "All four tracks in one shell.
> Memory · save state across runs with a real write-guard and query-sensitive recall.
> Tools · six domain playbooks with coverage scoring and a typed registry.
> Recovery · cockatiel plus sibling fallback plus a verifier that says 'I don't know.'
> Adaptation · compound voice commands and a steer endpoint that re-decomposes mid-stream.
> Eleven of eleven judge-regression checks passing right now against the live deploy.
> Repo, deck, schema, and a paste-ready hackathon form are in the GitHub README. Thanks for watching."

---

## Lower-third overlays to add in post

| Beat | Lower third |
|------|-------------|
| 0 | DelOS · agents under pressure |
| 1 | delrio.vercel.app |
| 2 | Top-bar counters: X-Tok-In · X-Tok-Out · X-Cost-Usd |
| 3 | Memory write-guard rejects preamble pollution |
| 4 | Playbook coverage score · investor-crm · 100% |
| 5 | Cohort God Mode · 5 models + verifier @ temp 0 |
| 6 | Chaos: tool outage → sibling fallback → critic pass |
| 7 | Voice chunker · 4 chunks → 4 intents |
| 8 | 11/11 regression checks · live deploy |

## Slides to drop into the recording (between beats)

If you want to splice graphic interstitials:

- After Beat 1: architecture mermaid diagram (from ARCHITECTURE.md)
- After Beat 4: coverage scorer diagram (playbook → required terms → patch)
- After Beat 5: cohort vs verifier flowchart
- After Beat 8: closing card with QR code → repo

## If you have time for extra credit

- Beat 9 (only if total still under 5:00): show the dock launching the WRONG app fix — type `:dock-audit` in the terminal to print the app-id mapping table. Proves you actually fixed it instead of saying you did.

## Things to NOT say

- "AI-powered"
- "Leveraged"
- "Next-gen"
- "Synergy"
- "Cutting-edge"
- "Game-changing"

## Things to definitely say

- "Eleven of eleven regression checks"
- "Sub-three-second deterministic stream"
- "Seventy-two hour recency half-life"
- "Cockatiel retry"
- "Sibling fallback"
- "Coverage floor of eighty-five percent"
- "Verifier at temperature zero"
- "I don't know" — yes, on camera; the judges value honesty

## Recording checklist

- [ ] Clear localStorage before recording
- [ ] Network throttling OFF (you want this to look smooth)
- [ ] Audio levels verified
- [ ] Two attempts minimum — first take is always too long
- [ ] Cut filler words in post (Loom has trim)
- [ ] Captions ON in Loom settings (judges sometimes mute)
- [ ] Title: `DelOS — Agents Under Pressure (4 min demo)`

## After recording

1. Download MP4 from Loom (gear icon → download)
2. Upload to YouTube as unlisted as a backup link
3. Paste the Loom URL into `outputs/HACKATHON_FORM.md` under "Demo video URL"
4. Drop the MP4 + a 30s GIF teaser into the GitHub README

That is it. Stop here. Do not over-script the close — your closing line works because it is dense, not because it is clever.
