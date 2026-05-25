# DelOS Chrome extension · install guide (v3.1)

Three tabs in a Chrome side panel. Mission for complex browser tasks
with in page overlay, Cohort for five model racing, Memory cross
synced with the website.

## Install

1. Clone or download this repo.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked**.
5. Select the `chrome-ext` folder.
6. The DelOS extension appears with the D logo as its icon.
7. Pin it to your toolbar (puzzle icon in Chrome, then pin DelOS).

## First run

1. Click the D icon. The side panel opens.
2. Header shows the D logo, brand name, version v3.1.
3. Connection pill shows `connected` when the server is reachable. If
   it shows `offline`, click the pill to retry.
4. Three tabs visible: **Mission**, **Cohort**, **Memory**. Mission
   is the default.

## Use it

### Mission tab
Type any complex task. Examples:
- `open hacker news and summarize the top five`
- `research the best wireless earbuds under 200 dollars 2025`
- `find airbnb listings in san francisco under 150 per night`
- `fill this form with john doe at john@example.com`

Press **RUN AGENT**. Watch the active page. A banner appears top
right saying "DelOS · 1 of N · navigate" and the element about to be
interacted with pulses with a colored outline. Each step screenshot
embeds in the side panel.

Below the log a follow up row is always open. Type a follow up and
press Enter. If it implies a browser action the agent re engages,
otherwise it answers from prior context.

### Cohort tab
Type a prompt, pick a preset (3 Groq, Mixed, Fast, God Mode), press
RUN COHORT. Five models race, a judge picks the winner. Verdict auto
saves to memory.

### Memory tab
Search, save, delete, copy. Same tenant id as the website so anything
saved on https://delrio.vercel.app/os shows up here within thirty
seconds.

## Settings

Click the cog at the top right.

- **Endpoint** defaults to `https://delrio.vercel.app`. Change to
  `http://localhost:3000` for local dev.
- **Tenant ID** defaults to `delrio_demo`. Change to share memory
  between extension and website by using the same tenant id on both.
- **Planner / Executor / Critic** model override pickers.

## Permissions

The manifest declares:
- `sidePanel` for the side panel UI
- `storage` for tenant id + endpoint config
- `activeTab` to read and act on the current tab when the user clicks
- `scripting` to inject the overlay and tab actions
- `contextMenus` for the right click Run DelOS mission on selection

No content script runs on every page. The overlay only mounts when
the user runs a Mission.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Pill shows offline | Click the pill to retry. If still offline, check `chrome://extensions` for errors. |
| Mission step says Cannot access chrome:// URLs | Open any regular webpage (google.com) and run the task from there. |
| Element highlight does not appear | Refresh the target page once. Overlay re mounts on `tabs.onUpdated`. |
| Memory tab empty | Confirm tenant id in settings matches the website. Use `delrio_demo` for the shared demo tenant. |
| Cohort returns rate limit | Wait 30 seconds and retry. The provider cascade picks up where the last attempt left off. |
| Side panel does not open on icon click | Chrome 114+ required. Update Chrome. |

## Development

The extension source lives in `chrome-ext/`:

- `manifest.json` v3 declaration
- `background.js` service worker, tab actions, overlay injection, screenshot capture
- `sidepanel.html` markup
- `sidepanel.js` unified Mission flow + chain re plan + Memory + Cohort
- `sidepanel.css` brand styling
- `icon.svg` D logo
- `content-sync.js` reads tenant id from the OS site

To reload after edits: open `chrome://extensions`, click the reload
arrow on the DelOS card.
