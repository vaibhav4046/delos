# Del Rio / DelOS — Build & Ship Manifest

One file. Every platform. Every artifact.

## SaaS (web)

```bash
npm install
npm run dev          # localhost:3000
npm run build        # production .next/
npm start            # serve production
```

Deploy: Vercel — `vercel --prod` (zero-config). Or any Node-hosted Next.js platform.

Required env vars (`.env.local`):

```
HYDRA_DB_API_KEY=...
GROQ_API_KEY=...
MISTRAL_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
DELRIO_TENANT_ID=delrio_demo

# optional — unlocks real Claude + GPT in chat apps
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...

# optional — premium TTS
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_MODEL_ID=eleven_turbo_v2_5
```

Routes that ship:
- `/` — landing
- `/os` — DelOS desktop with 24 apps
- `/play` — chaos demo
- `/memory` — memory browser
- `/docs` — API docs
- `/pricing` — tiers
- `/status` — health probes
- `/api/*` — 17 backend routes

## Chrome Extension

```bash
# Path: chrome-ext/
# 1. Build the main Next.js app first (so manifest can point at your host).
# 2. Update manifest.json `externally_connectable` if needed.
# 3. Load unpacked:
#    chrome://extensions → Developer mode ON → Load unpacked → select chrome-ext/
```

Features:
- Side panel (`sidepanel.html`) with full DelOS view
- Options page (`options.html`) for API key + tenant config
- Background worker (`background.js`) for context-menu actions
- Content sync (`content-sync.js`) reads page text into the agent

To package for Chrome Web Store: zip `chrome-ext/` contents (NOT the folder itself).

```bash
cd chrome-ext
zip -r ../delos-chrome-ext.zip . -x "*.DS_Store" -x "README.md"
```

Upload `.zip` to https://chrome.google.com/webstore/devconsole

## iOS / Android (Capacitor)

```bash
# 1. Build static export
npm run build

# 2. Sync Capacitor (one-time per platform)
npx cap add ios
npx cap add android
npx cap sync

# 3. iOS
npx cap open ios       # opens Xcode
# Product → Archive → Distribute App → TestFlight or Ad-Hoc

# 4. Android
npx cap open android   # opens Android Studio
# Build → Generate Signed Bundle/APK → APK → release
# APK output: android/app/build/outputs/apk/release/app-release.apk
```

App ID set in `capacitor.config.ts`. Splash + icons auto-generated from `/public/logo.svg`.

See `MOBILE.md` for the full Capacitor walkthrough.

## Desktop (Tauri)

```bash
cd src-tauri
cargo tauri build      # output: src-tauri/target/release/bundle/
```

macOS → `.app` + `.dmg`
Windows → `.exe` + `.msi`
Linux → `.AppImage` + `.deb`

See `src-tauri/README.md`.

## Static Files & Direct Links (after deploy)

| Artifact | Path |
|----------|------|
| SaaS app | https://YOURDOMAIN/ |
| DelOS desktop | https://YOURDOMAIN/os |
| API docs | https://YOURDOMAIN/docs |
| Status | https://YOURDOMAIN/status |
| Chrome ext (post-publish) | https://chrome.google.com/webstore/detail/YOUR-ID |
| Android APK (post-build) | upload to GitHub Releases, link → `releases/latest/download/delos.apk` |
| iOS TestFlight | https://testflight.apple.com/join/YOUR-CODE |
| Desktop installers | upload to GitHub Releases |

## QA Checklist (pre-ship)

```bash
npx tsc --noEmit                 # type-check — must be 0 errors
npx next build                   # build — must succeed
npx eslint src                   # lint — warnings ok, no errors
```

Manual smoke (each platform):
- [ ] Boot animation completes
- [ ] DelOS welcome shows 12 apps
- [ ] Dock magnification works (web only)
- [ ] Cmd+K opens palette
- [ ] Cmd+Shift+D runs demo tour (Assistant → Cohort → Voice → Cowork → Doom)
- [ ] Del Assistant: chat / code / cohort / research modes all respond
- [ ] Cowork autonomous run produces step list + output
- [ ] Doom 3D: pointer lock + 10 levels playable
- [ ] Voice: STT + TTS round-trip
- [ ] Light + dark theme toggle in Settings

## Hackathon Submit

Required artifacts:
1. **Live URL** — `vercel --prod` deploy
2. **GitHub repo** — `git push origin main`
3. **Demo video** — record 3min screen capture of demo tour
4. **Architecture diagram** — see README.md system overview
5. **One-line elevator pitch** — *"Browser-OS where multi-agent orchestration is wired in by default — memory, tools, recovery, adaptation — and agents build the apps live."*

## Build status (this checkpoint)

- ✓ 25 routes built
- ✓ TypeScript clean
- ✓ 24 desktop apps in dock
- ✓ Del Assistant (Claude-style with orchestration questions, mode picker, model selector)
- ✓ Cowork autonomous agent (plan → execute → deliver)
- ✓ 3D Doom 10 levels + realistic graphics (brick texture, fog, blood, weapon sway)
- ✓ Real Claude + GPT routes (when keys set)
- ✓ Brand SVG icons
- ✓ Glassmorphism premium polish
- ✓ Logo theme-aware (black in light, accented in dark)
- ✓ Chrome ext + Capacitor + Tauri configs present
