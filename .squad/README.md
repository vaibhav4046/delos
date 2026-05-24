# DelOS · Squad

DelOS runs as a **human-led AI agent team** following the Squad convention
(github.com/bradygaster/squad). Squad ships as a CLI for GitHub Copilot teams;
we adopt its **markdown-charter pattern** so every agent's role, scope, and
hand-off contract lives next to the code it operates on — inspectable, diffable,
git-tracked.

## Why Squad

DelOS already runs multi-agent orchestration in production (planner /
executor / critic / memory / codegen / voice). Before Squad, the agent
roles existed only inside `src/lib/agents/` — implicit, not documented as
a contract. The result: each new collaborator (human or AI) had to read
the source to understand the team.

Squad's charter pattern solves that. Each agent gets one markdown file
that answers:

1. **Role** — what does this agent do? what does it NOT do?
2. **Inputs** — what triggers it, what context does it read?
3. **Outputs** — what does it write, what does it hand to whom?
4. **Code home** — where in `src/` does its logic live?
5. **Models** — which LLM(s) does it run on, with what fallback?
6. **Risk level** — read / draft / reversible / external / money / destructive.

That's enough surface that a new coder (or Claude Sonnet picking up the
repo cold) can extend the right agent without trampling the others.

## Layout

```
.squad/
├── README.md                  # this file
├── decisions.md               # team-wide ADR log
├── routing.md                 # which intent → which agent
└── agents/
    ├── planner/charter.md     # Planner — decompose goal → ordered steps
    ├── executor/charter.md    # Executor — call tools, run steps
    ├── critic/charter.md      # Critic — verify each step's output
    ├── memory/charter.md      # Memory — HydraDB recall + persist
    ├── codegen/charter.md     # Codegen — multi-file project generation
    └── voice/charter.md       # Voice — STT, TTS, intent routing
```

## How to use

- **Adding a new agent** → drop a charter under `.squad/agents/{name}/charter.md`,
  reference its home directory in `src/lib/agents/{name}.ts`, register it in
  `routing.md`.
- **Recording a team decision** → append to `decisions.md` with date + rationale.
  Anyone reading the repo six months from now sees why we picked Kimi K2 over
  scout-17b (or whatever).
- **Changing an agent's behavior** → update its charter FIRST, then change code.
  Keeps the spec ahead of the implementation.

## Not adopted from Squad

- **CLI / npm package**: Squad ships as `@bradygaster/squad-cli` that drives
  GitHub Copilot. DelOS runs on its own Next.js + Vercel stack and doesn't
  shell out to Copilot. We borrow the markdown convention only.
- **Watch mode / Ralph polling**: DelOS already has its own intent bus
  (`src/lib/intentBus.ts`) for agent-to-agent dispatch. No external watcher
  needed.
- **SDK mode (`squad.config.ts`)**: experimental upstream, skipped for now.

## Links

- Squad project — github.com/bradygaster/squad
- DelOS prod — delrio.vercel.app
- DelOS repo — github.com/vaibhav4046/delos
