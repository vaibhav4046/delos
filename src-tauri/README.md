# Del Rio — Tauri Desktop Wrapper

Build native desktop binaries (macOS .app/.dmg, Windows .msi/.exe, Linux .deb/.AppImage) wrapping the Next.js DelOS app.

## Prereqs

- Rust toolchain: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Node 24+ + pnpm
- Platform-specific deps: [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

## One-time

```bash
pnpm add -D @tauri-apps/cli
pnpm exec tauri init   # if upgrading; this folder already has tauri.conf.json
```

## Dev

```bash
pnpm exec tauri dev
```

Opens a native window pointed at `http://localhost:3000`. Hot-reloads as you edit.

## Build

```bash
pnpm exec tauri build
```

Produces:
- macOS: `src-tauri/target/release/bundle/{macos,dmg}/`
- Windows: `src-tauri/target/release/bundle/{msi,nsis}/`
- Linux: `src-tauri/target/release/bundle/{deb,appimage}/`

## Cross-device sync

- Set the **same Tenant ID** in Settings → Device on every install.
- HydraDB partitions all memory by tenant — installs share state automatically.

## Mobile

Tauri 2.0 supports iOS + Android. After installing the mobile toolchains:

```bash
pnpm exec tauri ios init
pnpm exec tauri ios dev
pnpm exec tauri android init
pnpm exec tauri android dev
```

Or stay on PWA: Chrome menu → Install Del Rio (Mac/Win/Android), Safari iOS → Share → Add to Home Screen.
