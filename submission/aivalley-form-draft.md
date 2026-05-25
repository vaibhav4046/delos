# AIValley submission · Agents Under Pressure · DelOS draft

Paste these into https://www.aivalley.io/hackathons (Agents Under
Pressure category) and save as draft. Each section is sized to the
typical field length.

## Project name

DelOS

## One liner

A browser operating system for AI agents. Voice in, real apps out.
Memory that updates across every action.

## Live URL

https://delrio.vercel.app

## Open the OS directly (no login)

https://delrio.vercel.app/os?guest=1

## Sixty second judge demo (auto plays a narrated walkthrough)

https://delrio.vercel.app/os?guest=1&demo=judge

## GitHub repository

https://github.com/vaibhav4046/delos

## Five minute Loom video

(Record yourself running the script in `submission/loom-script-5min.md`
and paste the Loom URL here.)

## Short description (300 chars max)

DelOS is a browser operating system for AI agents. Voice commands open
real apps. Code generation streams a working project into a live IDE.
Five models race in the arena. Memory carries context across every
action. Gmail, Notion, GitHub, GDrive all in one tab.

## Long description (1200 chars max)

DelOS turns a browser tab into a small operating system for AI agents.
Twenty four apps live in a real window manager with a slim dock.

A voice agent parses twenty plus intents. You can say build me an
investor CRM and a working five page app streams into the IDE on the
right. You can say remember that my demo tenant is gastronomy one and
the assistant pins it. You can say what do you remember about my demo
tenant and the Memory Browser opens with the recall already done.

Five language models from three providers race the same prompt in the
Arena. A judge model scores them. The winner is written to memory
with an arena source tag.

Del Assistant runs MCP actions for Gmail draft, Notion page create,
GitHub list, and Google Drive list. Real APIs when you sign in, demo
previews when you do not.

HydraDB holds graph plus vector memory. Every meaningful action across
voice, code, calendar, schedule, arena, and search writes a typed
memory. The Memory Browser shows source badges so you see why every
entry exists.

A sixty second judge demo with a live narrator card runs from the
JUDGE DEMO button in the top bar.

## What problem does it solve

AI tools today live in separate tabs and separate memories. You cannot
draft an email in one place and ask a model in another to remember
what you sent. There is no surface that lets a voice command actually
build a working app while the same agent recalls last week's research.

DelOS is the operating layer underneath. One tab, shared memory, real
voice, real code generation, real model arena, real connectors.

## Why it stands out

It is a real operating system in a browser, not a chat UI with apps
glued on the side. Every pillar (voice, memory, code, arena,
connectors) is testable in the same tab. The judge demo is sixty
seconds with a live narrator card that explains each step in plain
English. No login, no card, guest mode is the demo.

## Tech stack

Next sixteen with Turbopack. React nineteen. TypeScript. Tailwind v4.
Framer Motion. HydraDB graph plus vector. Vercel AI SDK v6 with a six
provider cascade (Cerebras, Groq, Mistral, Gemini, NIM, Bytez).
Whisper Large v3 for speech to text. ElevenLabs Turbo v2.5 for speech
out. Zod for schema validation. JSZip for code export.

## HydraDB usage

HydraDB powers the memory layer. Twelve seed memories auto write to
any fresh guest tenant. Every voice store, arena verdict, codegen
completion, calendar event, and schedule action writes a typed memory
through `safeAddMemory`. Recall combines Hydra's graph plus vector
recall with a local fuzzy fallback so cross lambda reads always show
something useful. Write guard blocks noisy metric lines from polluting
the recall surface.

## Skills used (typical AIValley taxonomy)

- multi agent orchestration
- voice and speech recognition
- retrieval augmented generation
- vector and graph memory
- code generation and streaming SSE
- model arena and rubric judging
- MCP style tool integration
- Gmail and Notion API connectors
- browser based UI with window manager
- real time UI animations
- TypeScript end to end
- Next.js sixteen App Router
- HydraDB graph plus vector memory

## Roadmap

- Real OAuth flows for Gmail, Notion, GitHub, GDrive end to end
- Notion clone, Slack clone, Spotify clone added to the codegen
  playbook set so the prebuilt cockpits cover platform clones too
- Compound voice chunker improvement so four leg commands hold all
  intents
- Public Loom recording at five minutes
- HydraDB managed deployment as a one click template

## Team

Solo build by Vaibhav Lalwani.

## How to contact

Email mondayc852 at gmail dot com.
GitHub https://github.com/vaibhav4046

## How to verify in two minutes

1. Open https://delrio.vercel.app/os?guest=1
2. Press JUDGE DEMO in the top bar.
3. Watch the narration card explain each of five steps over sixty
   seconds.
4. Open Memory Browser in the dock. The recall is prefilled.
5. Press EXIT to leave the OS.

## Honest disclosures

- Gmail, Notion, GitHub and GDrive connectors return demo previews in
  guest mode. Real OAuth is wired but not configured for the public
  alias.
- The codegen domain cockpits are deterministic for six domains
  (Investor CRM, Regulatory AML, Clinical Trial, Legal Redline, AI
  Tutor, Ops Incident). Other prompts hit the LLM path and can be
  uneven if all providers exhaust quota.
- Sixty second judge demo runs the same scripted state machine on the
  homepage Demo link and the in OS JUDGE DEMO pill.
