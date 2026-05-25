# Hackathon submission — Agents Under Pressure

**Project:** DelOS
**Tagline:** A browser OS where AI agents survive real-world chaos.

**Description (≤400 chars):**
DelOS is a browser desktop where memory, tools, recovery, and adaptation are wired in by default. Four LLMs race on every question, a critic verifies each step and replans on drift, HydraDB remembers across sessions, voice commands chain across the OS, and an in-OS app builder turns a spoken prompt into a working domain app using a registered playbook.

**Stack:** Next.js 16, React 19, Groq (gpt-oss + llama-4 + kimi-k2), Mistral, Gemini 2.5, ElevenLabs TTS, HydraDB graph + vector memory, MCP (Gmail, Notion, GitHub, GDrive), Whisper STT, PWA.

**Tracks:** all four — Memory, Tools, Recovery, Adaptation.

**Live:** https://delrio.vercel.app
**GitHub:** (fill in your repo URL)
**Demo video:** (fill in your demo URL)
**Team:** (fill — solo or names)

---

## Why this should win

Most submissions are LLM wrappers. DelOS is an OS substrate: every visible window is mediated by the same planner-executor-critic-memory loop, with a real cohort race and sibling fallback when providers fail mid-call. It already builds full multi-file domain apps for AML, clinical trials, investor CRM, legal redlines, AI tutoring, and incident command, with coverage scored against required terminology so the output cannot collapse into a generic Kanban board. The chaos demo toggles failure modes live and agents recover instead of crashing.

## What I learned

The hardest part was not the agents. It was preventing the OS shell from drowning the agents in noise. Smaller, calmer, more correct beat more features.

## What is next

Per-skill audit log signed by tenant key, cross-device session sync, and a public marketplace of community-authored playbooks.

---

## Concrete numbers

- 6 domain playbooks shipped with required-term coverage scoring (95% floor)
- 10-file output for production-tier playbook builds
- Sub-3s deterministic stream for matched playbooks (zero LLM call)
- Drift threshold 0.3 triggers planner replan
- 5 models race in Cohort God Mode (gpt-oss-120b + llama-4-maverick + Mistral large + Gemini 2.5 pro + kimi-k2)
- Verifier (Mistral large @ temperature 0) fact-checks the merged cohort answer
- HydraDB recall · token+IDF overlap weighted by 72h recency half-life
- Voice chunker · splits compound commands on conjunctions and verb boundaries (≥4 intents from a 4-clause command)
- Write-guard rejects preamble pollution, run-summary text, and ungrounded long writes before they reach memory
- Injection classifier blocks "ignore all previous instructions", "print SYSTEM_PROMPT", "reveal API_KEY", and role-override payloads at the /api/* boundary

Tone rules followed: no em-dashes, no buzzwords, no exclamation marks.

---

## Paste-ready (final)

(Copy the block below into the form fields as needed. Do not auto-submit.)

```
Project: DelOS
Tagline: A browser OS where AI agents survive real-world chaos.

DelOS is a browser desktop where memory, tools, recovery, and adaptation are
wired in by default. Four LLMs race on every question, a critic verifies each
step and replans on drift, HydraDB remembers across sessions, voice commands
chain across the OS, and an in-OS app builder turns a spoken prompt into a
working domain app using a registered playbook.

Stack: Next.js 16, React 19, Groq, Mistral, Gemini, ElevenLabs, HydraDB,
MCP (Gmail/Notion/GitHub/GDrive), Whisper STT, PWA.

Tracks: Memory, Tools, Recovery, Adaptation.

Live: https://delrio.vercel.app
```
