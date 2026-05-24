# Del Rio — iOS + Android (Capacitor)

Native mobile shell wrapping the Next.js build. Same React code, same APIs.

## Why Capacitor (not Tauri)

Tauri 2.0 supports mobile but the toolchain is heavier. Capacitor is the simpler path for browser-OS-style apps that mostly need a WebView + a few native bridges (camera, push, share).

## One-time setup

```bash
pnpm add -D @capacitor/cli @capacitor/core
pnpm add @capacitor/ios @capacitor/android
pnpm add @capacitor/splash-screen @capacitor/status-bar @capacitor/share

pnpm exec cap init "Del Rio" com.delrio.app --web-dir=out
```

`capacitor.config.ts` is already committed at repo root.

## Build static export of Next.js

Capacitor needs static assets. Add to `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  output: "export",   // emits ./out
  images: { unoptimized: true },
};
```

Then:

```bash
pnpm run build      # static export → ./out
pnpm exec cap sync
```

> **Note:** static export disables SSR. Move all `app/api/*` routes to a hosted backend (Vercel / Cloudflare / Fly) and point client fetches at that origin via `NEXT_PUBLIC_API_BASE`. The orchestrator + MCP server can't live inside Capacitor.

## iOS

```bash
pnpm exec cap add ios
pnpm exec cap open ios
```

Builds Xcode project. Open Xcode, sign with your Apple ID, deploy to simulator or device.

App ID: `com.delrio.app`. Bundle identifier matches the capacitor config.

## Android

```bash
pnpm exec cap add android
pnpm exec cap open android
```

Opens Android Studio. Run on emulator or USB device.

Package name: `com.delrio.app`.

## Cross-device sync

Mobile app uses the same **Tenant ID** flow as web (Settings → Device). Set the same ID on Mac + iPhone + Android — all 3 see the same HydraDB memory + built apps.

## Native features

Capacitor plugins enabled:

- **Splash Screen** — 800ms pixel-art splash on launch
- **Status Bar** — dark style, midnight background
- **Share** — native share sheet for run results (call `Share.share({ text })` from JS)

To add more (camera, push, biometrics), `pnpm add @capacitor/<plugin>` then `cap sync`.

## App Store submission checklist

1. App icons in `ios/App/App/Assets.xcassets/AppIcon.appiconset/`
2. Privacy policy URL (required since iOS 17.4)
3. Bump `CFBundleShortVersionString`
4. Archive → upload via Xcode Organizer
5. TestFlight beta then App Store review

Android Play Store equivalent: signed `.aab` from Android Studio → Google Play Console → release tracks.

## PWA fallback

The PWA at the root URL covers ~90% of mobile use cases without app stores:

- **iOS Safari**: Share → Add to Home Screen
- **Android Chrome**: ⋮ → Install app

PWA install uses `public/manifest.webmanifest`. No Capacitor required.

🪨 Same React code · same APIs · runs everywhere.
