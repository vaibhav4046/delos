# DelOS · RECORD NOW · final hackathon submission

Last commit: `5401fc1` (voice dedupe) plus follow-ups in this session.
Live URL: https://delrio.vercel.app/os?guest=1
Guest demo: https://delrio.vercel.app/os?guest=1
Deck: https://delrio.vercel.app/deck.html
Repo: https://github.com/vaibhav4046/delos

## Before you hit record

1. Pin the Chrome extension (Load unpacked from `chrome-ext/`).
2. Hit https://delrio.vercel.app/os?guest=1 once · this auto-warms NIM.
3. Have https://news.ycombinator.com open in another tab.
4. Open the side panel pinned to Mission tab.
5. Mute system notifications. Fullscreen the recording window.

## The 5 killer beats (read out loud, in order)

1. "One tab. Twenty seven apps. Guest mode is the demo."
2. "Memory lives in HydraDB, not in the model."
3. "Same brand and same tenant in the Chrome extension."
4. "The agent is acting on the live page, not on a sidebar screenshot."
5. "Same memory across both surfaces." ← closer

## Reference script

See `submission/loom-script-FINAL.md` for the full 5-minute spoken script.

## What to do if something breaks live

| Symptom | Fix |
|---|---|
| Browse-agent slow | NIM cold start · 12s race fix auto-fallback to Groq |
| Cohort missing model | audit drives availability · model auto-drops |
| Memory empty | EmptyState auto-seeds demo memories for guest tenants |
| Extension says offline | click the pill to retry · 3× backoff probe |
| chrome:// page | extension shows muted skip · open any real site |

## Verified pre-recording (live, post commit `5401fc1`)

- 12/12 voice intents PASS (no leaked unknown/rejected/browserand chunks)
- 12/12 API smoke matrix PASS
- 11/11 regression PASS
- Memory negative recall PASS (apple banana XYZ → empty)
- Memory positive recall PASS (favorite color → match)
- Audit healthy/unhealthy exposed · cohort filters dead models

Go close it.
