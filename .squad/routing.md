# Routing

Which intent goes to which agent. The `voice-command` route classifies the
user's transcript into one of these intents, then dispatches via the OS
intent bus (`src/lib/intentBus.ts`). The receiving app already listens
for the right `kind`.

| Intent           | Agent(s)              | Bus kind             | App           |
|------------------|-----------------------|----------------------|---------------|
| `run_mission`    | planner + executor + critic + memory | `terminal.run`    | Terminal      |
| `build_app`      | codegen → preview     | `builder.build` / `codebase.build` | App Builder / Codebase |
| `run_cohort`     | judge + N members     | `cohort.run`         | Cohort Council |
| `recall_memory`  | memory                | `memory.search`      | Del Assistant |
| `open_app`       | (none — UI only)      | `delos-launch-app`   | n/a           |
| `close_window`   | (none — UI only)      | `delos-close-focused`| n/a           |
| `change_wallpaper`| (none — UI only)     | `delos-wallpaper-cycle`| n/a         |
| `navigate`       | (none — UI only)      | `location.href`      | n/a           |
| `answer`         | planner (direct)      | `voice.toast`        | Voice Agent   |

## Notes

- **Approval gate** — any intent flagged `external | money | destructive` in
  `src/lib/skillManifest.ts` pauses for a user tap before dispatch. Voice
  agent cannot bypass; see `.squad/agents/voice/charter.md`.
- **Risk classification** — read tier intents fire immediately. Higher tiers
  surface the ApprovalGate modal first.
