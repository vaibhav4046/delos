# RECORD NOW · final demo day plan

Round 5 hardening just shipped. Three lifts:

1. Cohort transient retry · arena rows bounce once on 429, timeout,
   upstream blip. One flaky model no longer kills the demo row.
2. OS mount prewarms cold lambdas in parallel. First click is fast.
3. VibeCode default prompt now reads "Investor CRM with warm intro
   graph, pipeline kanban from sourced to closed, follow up reminder
   dock". Judge who hits BUILD APP without typing gets a real domain
   app, not a stopwatch.

Probability is NOT 100. No live software is. Honest range now sits at
top three 75 percent, number one 35 percent. The remaining gap is
demo day variance, other entries, and judge subjective taste.

## Before you hit record

```
1. Open https://delrio.vercel.app/os?guest=1 in fullscreen
2. Wait ten seconds. Counters tick. Lambdas warm.
3. Hit JUDGE DEMO once to confirm the overlay narrates cleanly.
   If any step shows GAME OVER, refresh and try again.
4. Cancel that test run (press Escape).
5. Close all extra windows in the OS.
6. Open OBS / Loom. Pick 1080p, sixty fps.
7. Mic gain medium. Test "hi" first, listen back.
```

## Recording order

Read submission/loom-script-5min.md aloud at a calm pace. Five
sections, sixty seconds each. Total target five minutes.

Pause two beats between paragraphs so the screen catches up.

When the script says "Press JUDGE DEMO", press the pill in the top
bar. The overlay card with the timer will lead the rest of the
narration.

## Three lines NOT to say

- "AI revolution"
- "Game changing"
- "Everything you need"

These hit judge bingo cards.

## Three lines YOU SHOULD say

- "Built solo in forty eight hours."
- "Six providers, deterministic playbooks for failure cases. The
  demo never stalls because one model rate limits."
- "HydraDB sits underneath. Memory is the shared spine."

## Time check

You said fifteen minutes. Round five hardening is done. Vercel is
deploying right now. Two minutes for deploy, three minutes for prewarm
in Vercel edge, then you can record.

Total readiness: NOW + 5 minutes.

## After recording

Upload to Loom. Set thumbnail to the desktop with three windows open.
Paste the URL into `submission/aivalley-form-draft.md` in the Loom
field. Submit the AIValley form as draft. Done.

## What still can go wrong on demo day

- Mistral hits TPD mid Loom. Codegen falls to playbook. Card says
  fallback engaged. Narrate it as resilience.
- Memory pane briefly empty on cold lambda. Refresh once.
- Provider quota tripped → arena row red. The retry catches most.

## What I would do if I were you

Record three takes. Pick best. Cut tightly. Five minutes max. Submit
within the next hour. Sleep on it.

Then enter judging fresh.
