# Screenshot capture guide

Drop the captured PNGs into this folder using the filenames below. The
README references them at the relative paths so no extra wiring is
needed.

| File | What to capture | How |
|---|---|---|
| `os-desktop.png` | OS first boot, dock at bottom, ShortcutsSticky visible | https://delrio.vercel.app/os?guest=1 · resize browser to 1440x900 · F11 fullscreen · screenshot |
| `os-judge-demo.png` | Judge demo narration card mid run | Open /os?guest=1, press JUDGE DEMO pill, capture at step 3 of 5 |
| `memory-app.png` | Memory Browser with 12 seed entries plus run writes, source badges visible | Open /os?guest=1, click Memory in dock, wait for refresh |
| `vibecode.png` | VibeCode prompt input with DelCode pane streaming files | /os?guest=1 · launch App Builder · type "Investor CRM" · capture at file 3 of 5 landing |
| `arena.png` | Five model race in progress, scorecard partial | /os?guest=1 · launch Arena · type any prompt · capture mid race |
| `voice-agent.png` | Big mic button with audio level ring expanded | /os?guest=1 · launch Voice · press mic · speak · capture |
| `ext-mission.png` | Chrome extension side panel, Mission tab, task entered | Pin extension · click icon · type a complex task · screenshot before pressing RUN |
| `ext-overlay.png` | The killer one. In page overlay banner + colored highlight on a real page | Open hacker news · run Mission "summarize top 5" · capture when banner is visible and an element pulses |
| `ext-cohort.png` | Extension Cohort tab with race results | Switch to Cohort tab · enter prompt · capture mid stream |
| `ext-memory.png` | Extension Memory tab with synced entries from the website | Run something on website first, switch to extension Memory tab |
| `memory-sync.png` | Side by side · website Memory app and extension Memory tab showing same entries | Use the OS snapping (Win+Left / Win+Right) or take two screenshots and arrange |

## Format

- PNG (better text rendering than JPEG)
- 1440x900 or 1920x1080
- Default browser zoom 100 percent
- Hide bookmarks bar, dev tools, notifications
- Use the yellow brand color as the visual anchor in every shot

## Bonus shots for marketing

- A close up crop of the in page overlay banner
- The audio level ring around the voice mic
- The dock magnification on hover
- The desktop with three windows snapped in a 50 percent grid

## Where these are referenced

- `README.md` table at the top of the repo
- `submission/EVALUATION.md` walkthrough
- `submission/loom-script-FINAL.md` recording cues
