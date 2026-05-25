# AI Valley · Agents Under Pressure submission · DelOS

Paste these into https://www.aivalley.io/hackathons/agents-under-pressure-build-your-own-os.
Save as draft, review, then submit.

No em-dashes anywhere. No buzzwords. Numbers spelled where they read better.

## Project name

DelOS

## One liner

A browser operating system for AI agents. Voice, memory, browser control, and five model cohort racing live in one tab and one Chrome extension that share the same Hydra graph plus vector memory.

## Live URL

https://delrio.vercel.app

## Open the OS directly (no login)

https://delrio.vercel.app/os?guest=1

## Sixty second judge demo

https://delrio.vercel.app/os?guest=1&demo=judge

## Chrome extension (sidepanel, manifest v3)

Repo path: /chrome-ext
Install: chrome://extensions, Developer Mode on, Load Unpacked, point at the chrome-ext folder.
Version: 3.1.0

## GitHub repository

https://github.com/vaibhav4046/delos

## Loom video (five minutes)

(paste your Loom URL after recording the script in submission/loom-script-FINAL.md)

## Short description (300 chars)

DelOS is a browser operating system for AI agents. The website runs twenty four apps in a real window manager. The Chrome extension performs complex browser tasks with live element highlights and screenshots. Both share the same Hydra memory by tenant id so context follows you everywhere.

## Long description (1200 chars)

DelOS turns one browser tab into a small operating system. The site at delrio.vercel.app boots into a desktop with twenty four real apps. Window manager, dock with magnification, voice agent, memory browser, code app builder, browser, arena for five model racing, schedule, calendar, notification center.

The Chrome extension at /chrome-ext is the second half. Three tabs only. Mission runs complex browser tasks. The agent plans, opens a URL, scrolls, clicks, fills, extracts, summarizes, then chains a second round if the task is not done. Each step pulses a colored outline on the actual page element it is acting on, the same way Perplexity Comet and Claude in Chrome do. Cohort races five models in parallel and a judge picks the winner. Memory is interactive with search, save, delete, and copy.

Both surfaces share one tenant id. A run from the extension shows up in the website Memory app within seconds and the other way around. HydraDB holds the graph plus vector store. Twelve seed memories auto write to any fresh tenant so the demo never starts empty.

Voice agent is hardened for far field capture. Continuous mode is on, three confidence alternatives, auto restart on silence, live audio level ring around the mic so the user sees it is hot from across the room.

## What problem does this solve

Most AI tools today live in separate tabs and separate memories. You can ask one chatbot to draft an email and ask another to remember context, but neither one can act on the page in front of you, and neither remembers what the other did.

DelOS sits underneath. One tenant id, shared memory, browser control from inside the extension, voice and code generation from inside the website. Voice asks the agent to research a topic, the extension navigates the search results, the website memory shows the writeup the moment it lands, the next prompt picks up the context without re asking.

## Why it stands out

Real Chrome extension that actually moves the cursor, clicks elements, fills forms, then highlights what it touched on the page itself. Not a sidebar that pretends to act.

Twenty four real apps in a window manager with real drag, resize, snap, maximize, and minimize. Not a chat with cards in it.

Five model cohort with judge scoring. Provider cascade with six providers so one quota out does not stop the demo.

Memory that updates live across both surfaces using one Hydra tenant.

Voice that survives distance and silence. Hardened against the usual Chrome SpeechRecognition failure modes.

No login. Guest mode is the demo.

## Tech stack

Next sixteen with Turbopack. React nineteen. TypeScript end to end. Tailwind v4. Framer Motion. HydraDB for graph plus vector memory. Vercel AI SDK v6 over Groq, Mistral, Google Gemini, NVIDIA NIM Nemotron, Cerebras, and Bytez. Whisper Large v3 for speech to text. ElevenLabs Turbo v2.5 for speech out. Zod for input schemas. JSZip for code export.

Chrome extension is manifest v3, sidepanel API, chrome scripting for in page overlay, chrome storage for tenant sync. No content script needed for the agent loop.

## Hydra DB usage

HydraDB is the memory backbone for both surfaces. Every mission run, cohort verdict, voice store, code generation result, calendar event, schedule action, and browser save writes a typed memory through safeAddMemory. Recall combines Hydra graph plus vector recall with a local fuzzy fallback so cross lambda cold reads still surface something useful.

Twelve seed memories prepopulate any fresh tenant so the demo never starts blank. A write guard blocks noisy metric strings from polluting the recall surface. The extension and the website both read and write under the same tenant id, so a save from one appears in the other within a poll cycle.

## How a judge can verify in under two minutes

Step one. Open https://delrio.vercel.app/os?guest=1
Step two. Press the JUDGE DEMO pill in the top bar. Watch sixty seconds of narrated steps land in real apps.
Step three. Open Memory in the dock. Every step from the demo is already saved with a typed source badge.
Step four. Install /chrome-ext. Click the extension icon. Type "open hacker news and summarize the top five" in the Mission tab. Press RUN AGENT. Watch the in page overlay narrate the steps. The summary lands in the panel.
Step five. Reopen the website Memory app. The browser run from the extension shows up at the top.

## Honest disclosures

Connectors for Gmail, Notion, GitHub, and Google Drive return real data when the user signs in with OAuth, and a demo preview labeled clearly when the user is in guest mode.

The six domain code app cockpits (Investor CRM, Regulatory AML, Clinical Trial, Legal Redline, AI Tutor, Ops Incident) are deterministic so the demo never stalls. Other prompts run through the streamed LLM path.

If a model provider rate limits during the demo, the agent falls back to the next provider in the cascade. The Mission tab in the extension surfaces the friendly retry message instead of a raw error.

Vercel free tier deploys cap at one hundred per day. The repo is committed up to the latest fix and the deploy lands on the next cap reset window when needed.

## Team

Solo build. Vaibhav Lalwani.

## Contact

Email mondayc852 at gmail dot com.
GitHub https://github.com/vaibhav4046

## Tracks claimed

Memory. Tools. Recovery. Adaptation.

Memory: Hydra graph plus vector under one tenant, twelve seed entries, recall fallback, write guard, cross surface sync.
Tools: Chrome extension that actually clicks and fills the page, five model arena, MCP connectors, code app builder with streamed SSE, Gmail and Notion and GitHub and Drive integrations.
Recovery: Six provider cascade, deterministic domain cockpits when LLMs exhaust quota, friendly UX for rate limits, auto restart on STT silence, graceful skip on chrome:// pages.
Adaptation: Chain re plan up to three rounds for any complex task, endless conversation that re engages browser actions on follow ups, voice mic auto restarts up to thirty times across a session.
