# DelOS · 5-minute Loom script

Speak short lines. Pause between cuts. Don't read the timestamps out loud.
Backup typed commands are below each spoken voice command in case the mic
is finicky on demo day.

---

## 0:00 — Hook (10s)

> "This is DelOS. It's a browser OS that runs autonomous agents — voice,
> memory, code generation, and a model race. One link. One tab. No login
> needed."

Open `https://delrio.vercel.app/os?guest=1` in fullscreen.

---

## 0:10 — OS overview (30s)

> "Pixel-art shell. Real apps in real windows. Dock at the bottom,
> live counters at the top — agents, requests, tokens, cost."

Hover the dock. Open Launchpad (⌘Space) → close it. Point at counter strip:

> "These tick up as agents run. Skeleton dots until the first stats
> response — no fake zeros at first paint."

---

## 0:40 — Voice → app (60s)

Open Voice Agent from the dock.

Voice:
> "Build me an investor CRM with warm intro graph and a sourced-to-closed
> pipeline kanban."

Backup (typed): paste prompt directly into VibeCode.

> "VibeCode opens. Codegen starts streaming. You're watching the
> planner pick a domain — investor CRM — then files land one at a time.
> If a provider runs out of tokens, we fall back to a deterministic
> playbook so the stream still finishes."

---

## 1:40 — VibeCode / DelCode (40s)

> "DelCode preview is split-view inside the same window — judges see
> exactly which files dropped, file checklist, full source. Export as
> ZIP or single-file HTML, run it locally."

Show the file checklist. Click a file. Click EXPORT.

---

## 2:20 — Memory recall (40s)

Voice:
> "Remember that my demo tenant is gastronomy one."
> (2-second pause)
> "What do you remember about my demo tenant?"

Backup (typed): use the textbox fallback in Voice Agent.

> "Memory Browser opens with the recall hit pre-filled. Source badge
> shows VOICE MEMORY — every memory carries its origin tag now. HydraDB
> graph + vector under the hood."

---

## 3:00 — Arena / cohort race (40s)

Open Arena. Click ▶ START RACE on the default prompt.

> "Five models from three providers race the same prompt. Judge model
> scores them on coverage and length. Disagreement score on the side.
> Winner gets persisted to memory — search 'last arena winner' and it
> comes back."

---

## 3:40 — Browser + browse agent (35s)

Open Browser. Type "OpenAI official documentation".

> "Custom web_search hits DuckDuckGo lite first, Wikipedia fallback,
> with token-overlap scoring and official-domain boosts. No iframe?
> Clean 'open in new tab' fallback."

---

## 4:15 — Calendar / reminders / schedule (30s)

Voice:
> "Schedule lunch next Friday at 1pm."
> "Remind me to call Andy in 30 minutes."
> "Set up a daily email digest."

> "Title parses cleanly — 'lunch', not 'Event'. Reminder gets a dueAt.
> Schedule actions write to memory too — recall 'what automations did
> I set up' surfaces them."

---

## 4:40 — Why this wins (20s)

> "Five pillars: voice that actually builds, memory that updates across
> actions, model arena, codegen with export, autonomous MCP — Gmail,
> Notion, GitHub, GDrive — all in one browser tab. Demo mode is honest:
> Gmail and Notion show a 'simulated' badge until OAuth is wired."

> "Built solo. Forty-eight hours. delrio.vercel.app."

Cut.

---

## Demo-day notes

- **Mic permissions**: grant on first prompt. Voice button shows a red
  pulse when armed.
- **Provider quotas**: if Mistral/Groq hits TPD mid-demo, codegen still
  finishes via the deterministic playbook — the toast says "fallback
  engaged" so you can mention it.
- **Sticky tutorial**: the overlay auto-dismisses on first app open.
  If it's lingering, the `★ CLOSE` chip in the top-right corner kills
  it instantly.
- **MCP demos**: Gmail draft + Notion page run in `demo:true` mode in
  guest sessions. The toast says "simulated · OAuth not connected" —
  this is the honest path; don't pretend it sent real mail.
- **Don't say "10/10"** unless every box in `submission/qa-report.md`
  is green.
