# DelOS · pre-recording demo checklist

Do this in order. Tick boxes as you go. Recording target ≤ 5 minutes.

## Pre-flight (5 min before)

- [ ] Use Chrome (or Edge). Safari has stricter mic + iframe behavior.
- [ ] Open `https://delrio.vercel.app/os?guest=1` in a **fresh window**
      (no tabs, no extensions popping toasts).
- [ ] Hard-reload (⌘ Shift R) so the latest deployment is loaded.
- [ ] Click anywhere on the page to satisfy the "user gesture" requirement
      before mic / TTS kicks in.
- [ ] Open System Preferences → Sound · pick the right input. Test that
      the level meter moves when you talk.
- [ ] In Chrome → Settings → Site Settings → Microphone · ensure
      delrio.vercel.app is set to "Allow".
- [ ] Test mic by opening Voice Agent and saying "hello" — it should
      come back with "Hey — what should we build?".
- [ ] Close the sticky tutorial overlay if it's covering the dock.
      The `★ CLOSE` chip is in the top-right of the overlay.

## Mic vs typed fallback

If the mic doesn't behave on take 1:

- [ ] Voice Agent has a textbox fallback under the mic button — paste
      the same command text and hit ↵.
- [ ] DelAssistant accepts the same intents typed into its chat.

## Recording

### Take order

1. **Hook (0:00–0:10)** — open the URL in fullscreen, brief intro.
2. **OS overview (0:10–0:40)** — point at dock, Launchpad, counter
   strip, mention skeleton dots.
3. **Voice → app (0:40–1:40)** — voice prompt below.
4. **VibeCode / DelCode (1:40–2:20)** — show file checklist, click a
   file, click EXPORT.
5. **Memory recall (2:20–3:00)** — voice prompts below.
6. **Arena race (3:00–3:40)** — Arena → START RACE.
7. **Browser + browse agent (3:40–4:15)** — search "OpenAI official
   documentation".
8. **Calendar / reminders / schedule (4:15–4:40)** — voice prompts
   below.
9. **Closing (4:40–5:00)** — read closing lines from the script.

### Exact voice commands to say

Each one has a typed backup if the mic misfires. Paste the typed
version into Voice Agent's fallback box.

**Build:**
- Voice: "Build me an investor CRM with warm intro graph and a sourced
  to closed pipeline kanban."
- Typed backup: paste into VibeCode prompt textbox.

**Memory store:**
- Voice: "Remember that my demo tenant is gastronomy one."
- Typed backup: same string in Voice Agent fallback.

**Memory recall:**
- Voice: "What do you remember about my demo tenant?"
- Typed backup: same string.

**Arena:**
- Click ▶ START RACE. No voice needed.

**Browser search:**
- Voice: "Open browser and search OpenAI official documentation."
- Typed backup: type `OpenAI official documentation` into the browser
  URL bar.

**Calendar:**
- Voice: "Schedule lunch next Friday at 1pm."
- Typed backup: open Calendar app, click NEW EVENT.

**Reminder:**
- Voice: "Remind me to call Andy in 30 minutes."
- Typed backup: open Schedule app, click NEW.

**Schedule action:**
- Voice: "Set up a daily email digest."
- Typed backup: open Schedule app, click NEW with kind=read_email.

## Expected visual proof per step

| Step | What the camera should catch |
|------|------------------------------|
| Voice build | VibeCode window opens · file checklist starts populating · DelCode preview pane shows code |
| Codegen done | Toast: "✓ project complete" · file count visible |
| Memory store | Toast: "Saved · my demo tenant is gastronomy one" |
| Memory recall | Memory Browser opens · query pre-filled · row with VOICE MEMORY badge |
| Arena | 5 model rows · status pills change spawn → done · winner highlighted · disagreement number |
| Browser | First result is `platform.openai.com` or `openai.com/docs` · NOT Wikipedia |
| Calendar | Calendar widget shows "Lunch · Fri 1:00 PM" — title is "Lunch", not "Event" |
| Reminder | Schedule app shows "call Andy · in 30 min" |

## Fallback if provider rate limit hits

- Codegen: toast says "fallback engaged · deterministic playbook" —
  this is *fine*, narrate it as a feature ("when LLMs fail we still
  finish").
- Arena: rubric fallback kicks in if the judge LLM fails — verdict
  card says "rubric fallback · {model} picked for best coverage".
- Voice: STT cuts out → use the textbox fallback in Voice Agent.

## What NOT to claim

- Don't say Gmail / Notion / GDrive / GitHub actions *executed* —
  they're `demo:true` in guest mode. Toast says "simulated".
- Don't say "real-time agent" unless you're showing the SSE stream.
- Don't say "10/10" — leave the rating to the judge.

## Post-recording

- [ ] Watch back at 1.5× speed. Is anything covered by the tutorial
      overlay? If yes, retake that segment.
- [ ] Crop to ≤ 5 minutes.
- [ ] Upload to Loom. Set thumbnail to the OS desktop with all 5
      windows arranged.
