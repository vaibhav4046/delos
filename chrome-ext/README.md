# Del Rio — Chrome Extension (v2)

Side-panel companion to **DelOS**. Run agent missions, cohort runs, voice agents, and recall memory from any tab.

## Install (unpacked)

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Pick this `chrome-ext/` folder
5. Pin the extension to the toolbar
6. Click the toolbar icon → side panel opens

> **Shortcut:** `Ctrl+Shift+D` (Win/Linux) or `Cmd+Shift+D` (Mac) opens the side panel on the focused tab.

## Auto-sync with main app

While the side panel is open, also open the DelOS web app at **http://localhost:3000** in any tab. The content script (`content-sync.js`) reads:

- `delos.tenantId.v1`
- `delos.modelOverrides.v1`
- `delos.mcpServers.v1`

…from `localStorage` and pushes them into the extension's `chrome.storage.local`. A green `● ext linked` badge flashes in the corner when sync fires. After that, the side panel works on **any other tab** with the same config.

## Panels

### Mission
- Type a goal or click **⤓ Use current tab** to inject selected text / page text as context
- Toggle chaos modes (flake / outage / context flood)
- **🎤 Voice** — STT into the goal field (Web Speech API, free)
- **▶ RUN** — streams SSE events from `/api/run` with full agent trace
- **★ STEER** — appears mid-run; sends live instructions to the orchestrator via `/api/steer`
- Token + LLM-call stats at the top

### Cohort
- Same goal across multiple models in parallel
- Presets: 3× Groq · Mixed (Groq + Gemini + Mistral) · Fast (small models)
- Judge LLM scores and merges → final answer

### Voice
- Hands-free conversation loop
- **🎤 HOLD TO TALK** — speech → quick-agent → speak reply
- **loop** toggle keeps the conversation going
- **speak reply** toggle controls TTS

### Memory
- Recall from HydraDB scoped to your tenant ID
- Shows hits + local fallback with tags

## Settings (gear icon)
- Endpoint URL (defaults to `http://localhost:3000`)
- Tenant ID (same across devices → instant sync)
- Per-role model overrides

## Context menu

- Select any text → right-click → **"Run Del Rio mission on '…'"** → side panel opens with the selection pre-filled as the goal.

## Permissions used

- `sidePanel` — open the side panel via toolbar
- `storage` — persist endpoint / tenant / models / MCP servers
- `activeTab` — read current tab when you tap **Use current tab**
- `scripting` — inject grab-page-text into focused tab on demand
- `contextMenus` — right-click → run mission on selection
- `host_permissions` — `localhost:3000`, `*.delrio.app`, `api.hydradb.com`

## Cross-platform

The companion runs everywhere Chrome runs (Windows / Mac / Linux / Chrome OS / Android Chrome). For native desktop, see `../src-tauri/README.md`. For iOS, install the PWA from `http://localhost:3000` via Safari → Share → Add to Home Screen.

## Demo flow (60s)

1. Open `http://localhost:3000/os` once → see `● ext linked` badge → settings sync
2. Switch to any other tab (e.g. a Wikipedia article)
3. Open side panel (`Ctrl+Shift+D`)
4. Click **⤓ Use current tab** → page text fills the goal
5. **▶ RUN** → live trace streams, tokens count, drift critic fires
6. While running, type "focus on dates only" → **★ STEER**
7. Watch the agent adapt mid-stream
8. Switch to **Voice** tab → **🎤 HOLD TO TALK** → "What's a fun fact?" → agent speaks back
9. **Cohort** tab → ask a question → 3 models race → judge picks winner

## Troubleshooting

- **`● offline` pill** — main app at `localhost:3000` isn't running. Start it: `node ./node_modules/next/dist/bin/next dev -p 3000`
- **Voice unsupported** — Chrome only. Other Chromium browsers may need flags.
- **Side panel won't open** — Chrome 114+ required. Update Chrome.
- **CORS** — host permissions in manifest already cover this. If you change the endpoint, add the host to `host_permissions`.

🪨 Built for **Agents Under Pressure** · HydraDB 48h hackathon · May 2026
