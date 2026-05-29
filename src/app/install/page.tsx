import Link from "next/link";
import type { Metadata } from "next";
import { Wordmark } from "@/components/Logo";
import { InstallButton } from "@/components/InstallButton";

export const metadata: Metadata = {
  title: "Install DelOS — full-screen app, offline-ready",
  description:
    "Install DelOS as an app on your phone, tablet, or desktop. Full-screen, offline-ready, home-screen icon, share-to-DelOS, and app shortcuts — no app store required.",
};

// Per-platform install instructions. The "Install now" buttons dispatch the
// global `delos-install` event so the OS-native prompt (Chromium) or the iOS
// Add-to-Home-Screen sheet (handled by <PwaInstall>) takes over.

type Step = { n: string; text: string };

const ANDROID: Step[] = [
  { n: "1", text: "Tap Install now below (or Chrome's ⋮ menu → Install app / Add to Home screen)." },
  { n: "2", text: "Confirm in the prompt." },
  { n: "3", text: "DelOS lands on your home screen and launches full-screen." },
];

const IOS: Step[] = [
  { n: "1", text: "Open this page in Safari." },
  { n: "2", text: "Tap the Share button, then Add to Home Screen." },
  { n: "3", text: "Tap Add — DelOS launches like a native app." },
];

const DESKTOP: Step[] = [
  { n: "1", text: "In Chrome or Edge, click the install icon in the address bar (or ⋮ → Install DelOS)." },
  { n: "2", text: "Confirm Install." },
  { n: "3", text: "DelOS opens in its own window and pins to your taskbar / dock." },
];

const PERKS: { icon: string; title: string; body: string }[] = [
  { icon: "▣", title: "Full-screen OS", body: "No browser chrome — the desktop, dock, and windows fill the whole screen." },
  { icon: "⚡", title: "Offline-ready", body: "A service worker caches the shell so DelOS opens even with no signal." },
  { icon: "⤴", title: "Share to DelOS", body: "Share a link or note from any app straight into Del Assistant." },
  { icon: "★", title: "App shortcuts", body: "Long-press the icon to jump to Del Assistant, the Chaos demo, or the live feed." },
  { icon: "▤", title: "Home-screen icon", body: "A crisp pixel-art icon that opens DelOS in one tap." },
  { icon: "◐", title: "Stays awake", body: "The screen won't dim mid-mission while an agent run streams." },
];

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-2 mt-3">
      {steps.map((s) => (
        <li key={s.n} className="flex gap-3 text-sm text-[color:var(--muted)]">
          <span
            className="font-pixel flex-shrink-0 flex items-center justify-center"
            style={{
              width: 22,
              height: 22,
              background: "var(--surface-2)",
              color: "var(--accent)",
              border: "1px solid var(--accent)",
              fontSize: 11,
            }}
          >
            {s.n}
          </span>
          <span style={{ lineHeight: 1.5 }}>{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

export default function InstallPage() {
  return (
    <div className="min-h-screen scanlines">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os?guest=1" className="btn-pixel success">★ DelOS</Link>
            <Link href="/" className="btn-pixel ghost hidden sm:inline-flex">Home</Link>
            <Link href="/docs" className="btn-pixel ghost hidden md:inline-flex">Docs</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <section className="text-center">
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ INSTALL</span>
          <h1 className="font-pixel text-3xl sm:text-5xl mt-4 mb-3 tracking-wider">
            install <span style={{ color: "var(--accent)" }}>DelOS</span> as an app
          </h1>
          <p className="text-[color:var(--muted)] text-sm sm:text-base max-w-2xl mx-auto">
            One tap. No app store. DelOS installs straight from your browser as a Progressive Web App —
            full-screen, offline-ready, and loaded with mobile-only extras.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <InstallButton className="btn-pixel success magnet" style={{ fontSize: 14, padding: "12px 22px" }} label="⬇ INSTALL NOW" />
            <Link href="/os?guest=1" className="btn-pixel ghost" style={{ fontSize: 14, padding: "12px 22px" }}>
              ▶ OPEN IN BROWSER
            </Link>
          </div>
          <p className="text-[color:var(--muted-2)] text-xs mt-3 font-mono">
            On iPhone/iPad use Safari · Add to Home Screen (steps below).
          </p>
        </section>

        <section className="grid sm:grid-cols-3 gap-4 mt-12">
          <div className="card-pixel">
            <h2 className="font-pixel text-lg tracking-wider mb-1">Android / Chrome</h2>
            <StepList steps={ANDROID} />
          </div>
          <div className="card-pixel">
            <h2 className="font-pixel text-lg tracking-wider mb-1">iPhone / iPad</h2>
            <StepList steps={IOS} />
          </div>
          <div className="card-pixel">
            <h2 className="font-pixel text-lg tracking-wider mb-1">Desktop</h2>
            <StepList steps={DESKTOP} />
          </div>
        </section>

        <section className="mt-14">
          <h2 className="font-pixel text-xl tracking-wider text-center mb-6">
            what you get when you install
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {PERKS.map((p) => (
              <div key={p.title} className="card-pixel flex gap-3">
                <span className="font-pixel text-2xl flex-shrink-0" style={{ color: "var(--accent)" }} aria-hidden>
                  {p.icon}
                </span>
                <div>
                  <div className="font-pixel text-sm tracking-wider mb-1">{p.title}</div>
                  <div className="text-xs text-[color:var(--muted)]" style={{ lineHeight: 1.5 }}>{p.body}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 text-center">
          <p className="text-[color:var(--muted)] text-sm">
            Same DelOS, every feature — now installable. Already running it as an app? You&apos;re all set.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <InstallButton className="btn-pixel" style={{ fontSize: 13, padding: "10px 18px" }} label="⬇ INSTALL DELOS" />
            <Link href="/scorecard" className="btn-pixel ghost" style={{ fontSize: 13, padding: "10px 18px" }}>
              SCORECARD
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
