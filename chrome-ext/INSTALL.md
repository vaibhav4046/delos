# DelOS Chrome Extension · INSTALL guide

## Path to load

```
C:\Users\lalwa\OneDrive\Desktop\claude max work\delrio\chrome-ext
```

## Steps (Chrome / Edge / Brave / Arc)

### 1. Enable Developer mode

```
chrome://extensions
```

Toggle **Developer mode** ON (top-right of that page).

### 2. Load unpacked

Click **Load unpacked** (top-left of `chrome://extensions`).

Browse to:

```
C:\Users\lalwa\OneDrive\Desktop\claude max work\delrio\chrome-ext
```

Select the folder. Click **Select Folder**.

### 3. Pin the extension

Click the puzzle-piece icon in Chrome's toolbar. Find **DelOS — Agents Under Pressure**. Click the pin icon next to it.

### 4. Open the side panel

Click the pinned DelOS icon in the toolbar. The side panel opens on the right.

Or use keyboard shortcut: `Ctrl+Shift+D` (Windows) / `Cmd+Shift+D` (Mac).

### 5. Set endpoint (one-time)

In the side panel:
- Click ⚙ (gear icon, top-right)
- **Endpoint** = `https://delrio.vercel.app` (already default)
- **Tenant ID** = leave blank for anon, or set to `demo_yourname` for a persistent demo tenant
- Click **SAVE**

You should see `● CONNECTED` in the header.

### 6. ★ Grant microphone permission (REQUIRED for Voice tab)

Chrome blocks mic access from extension pages until explicitly granted.

**First time you tap "HOLD TO TALK"** Chrome will prompt for mic access in a small dialog at the top of the side panel. Click **Allow**.

If you see `voice not-allowed` in the log:

1. Click the 🔒 / 🎤 icon in the URL bar (or the side-panel header)
2. Find **Microphone** in the dropdown
3. Change to **Allow**
4. Click the mic button again

Or globally:

```
chrome://settings/content/microphone
```

Add the extension's chrome-extension:// origin to the allowed list, or set the default to **Allow**.

## What the panel does

| Tab | What |
|---|---|
| **Voice** | Hold-to-talk autonomous voice agent. Acts on the current tab — summarize, click, fill, scroll, navigate, plus DelOS missions. |
| **Browse** | Perplexity-style multi-step browser agent. Type a complex task ("find me cheapest flight SF→NYC next Friday"), the planner generates 4-6 steps and executes them against the active tab. |
| **Mission** | Full DelOS orchestrator with planner-executor-critic-memory loop. Streaming SSE trace. Chaos toggles for flake/outage/flood. |
| **Cohort** | Race 3-5 LLMs in parallel. God Mode adds NIM Nemotron 49B + Mistral Large 3 + verifier. Disagreement score with cite-required pill. |
| **Memory** | Recall against your tenant's memory graph. |

## Verifying installation

After load, in the side panel header you should see:

```
DelOS v2.4  [● CONNECTED]
```

Click **Voice → 🎤 HOLD TO TALK** → grant mic permission → say *"open github"* → release. The Chrome tab should navigate to https://github.com.

Click **Browse**, type `find me a great pasta recipe`, hit RUN BROWSER AGENT. You should see a 4-6 step plan stream into the trace with each action and tier.

Click **Cohort**, type `HI`, pick `Mixed`, hit RUN COHORT. 3 model rows + judge merged answer should appear within ~5 seconds. Pick `★ GOD MODE` to spawn 5 with NIM verifier.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `● offline` in header | Endpoint wrong or DelOS API down. Check `https://delrio.vercel.app/api/health` in browser. |
| Voice `not-allowed` × N | Grant mic permission per step 6 above. Reload the side panel after. |
| Voice `no-speech` | Speak louder, closer to mic. Check input device in OS settings. |
| Browse `bad_request` | Server-side issue — file a bug. Should be live since `5340750`. |
| Mission "Model provider error" | Upstream LLM rate-limited. Wait 30s and retry. Extension now shows friendly message in v2.4. |
| Cohort "no results" | Empty goal field, or all 3 models hit rate limit simultaneously. Retry with `Fast` preset (lighter models). |
| Memory "no matches" | Anon tenant has no memories yet. Switch to `demo_test` in Settings and click again — auto-seeds. |

## Reload after updates

Whenever you pull new code:

1. `chrome://extensions`
2. Find DelOS card
3. Click the 🔄 reload arrow icon
4. Close + reopen the side panel

If the version pill in the header doesn't match `manifest.json`, reload didn't take.

## Uninstall

`chrome://extensions` → find DelOS → click **Remove**.

## Version history

| Version | Changes |
|---|---|
| 2.4.0 | Mic permission pre-flight + clear error UX, friendly mission error messages, install guide |
| 2.3.0 | Browse tab (Perplexity-style), Cohort godMode + disagreement, analyze tab, 7 verified models |
| 2.2.0 | Voice + Mission + Cohort + Memory tabs |

## Privacy

The extension's `host_permissions` are explicit: `localhost:3000`, `*.delrio.app`, `delrio.vercel.app`, `api.hydradb.com`. No data is sent to any other origin. Tab actions use `chrome.scripting.executeScript` which inherits `activeTab` permission — content scripts only run on the tab you're actively viewing.
