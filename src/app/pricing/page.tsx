import Link from "next/link";
import { Wordmark } from "@/components/Logo";

const tiers = [
  {
    name: "Free",
    price: "$0",
    tag: "Self-host forever",
    cta: "Clone the repo",
    href: "/os",
    lines: [
      "All 4 pillars (Memory/Tools/Recovery/Adaptation)",
      "Bundled MCP server with 8 tools",
      "Voice agents (Whisper STT + browser TTS)",
      "Up to 9 LLM models",
      "Cohort council",
      "PWA install + Chrome extension",
      "Tauri desktop wrap",
      "Community Discord",
    ],
  },
  {
    name: "Pro",
    price: "$19",
    tag: "per month",
    featured: true,
    // BUG-6 (red-team report): old href was "#" — looked clickable but
    // jumped to top of page. We do not have payment infra yet (acknowledged
    // in pricing copy), so the Pro CTA now points to the Discord waitlist
    // instead of a dead anchor. Once Stripe is wired, swap to /api/checkout.
    cta: "Join Pro waitlist",
    href: "https://discord.gg/UYsxv9PNU",
    lines: [
      "Everything in Free",
      "Hosted HydraDB tenant (no setup)",
      "Browser TTS default · ElevenLabs optional via your key",
      "Priority Groq Whisper quota",
      "Custom domain (yourname.delrio.app)",
      "Cross-device sync via tenant",
      "Email support (24h response)",
      "Save up to 1000 built apps",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    tag: "Contact sales",
    cta: "Talk to us",
    href: "mailto:sales@delrio.app",
    lines: [
      "Everything in Pro",
      "SSO (SAML / OIDC)",
      "Private MCP server fleet",
      "Audit logs + compliance exports",
      "99.9% SLA",
      "On-prem Tauri pack",
      "Dedicated success manager",
      "Custom model routing",
    ],
  },
];

const addons = [
  { name: "HydraDB", desc: "Per-tenant quota beyond free 500k tokens.", price: "starts $9/mo" },
  { name: "ElevenLabs voices", desc: "Custom cloned voices.", price: "starts $5/mo per voice" },
  { name: "Premium models", desc: "Claude / GPT-4o / Llama 405B routing.", price: "BYO key" },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os" className="btn-pixel success">★ DelOS</Link>
            <Link href="/" className="btn-pixel ghost hidden sm:inline-flex">Home</Link>
            <Link href="/docs" className="btn-pixel ghost hidden sm:inline-flex">Docs</Link>
            <Link href="/status" className="btn-pixel ghost hidden md:inline-flex">Status</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-12 space-y-12">
        <section className="text-center">
          <h1 className="font-pixel text-4xl sm:text-6xl mb-4 tracking-wider">
            Pay only if you want it <span style={{ color: "var(--accent)" }}>managed</span>.
          </h1>
          <p className="text-[color:var(--muted)] max-w-2xl mx-auto">
            Self-host DelOS with your own free-tier API keys — total cost $0/mo. Pro removes the keys + scaling work. Enterprise adds SSO + on-prem + SLA.
          </p>
        </section>

        <section className="grid md:grid-cols-3 gap-4">
          {tiers.map((t) => (
            <div key={t.name} className="card-pixel" style={{ borderColor: t.featured ? "var(--accent)" : "var(--surface-2)", boxShadow: t.featured ? "0 6px 0 0 var(--accent-shadow)" : undefined }}>
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="font-pixel text-2xl" style={{ color: t.featured ? "var(--accent)" : "var(--fg)" }}>{t.name}</h3>
                {t.featured && <span className="pill pill-info">most popular</span>}
              </div>
              <div className="font-pixel text-5xl" style={{ color: "var(--accent)" }}>{t.price}</div>
              <div className="text-xs text-[color:var(--muted)] tracking-wider uppercase mt-1 mb-4">{t.tag}</div>
              <ul className="space-y-1 text-sm mb-6">
                {t.lines.map((l) => (
                  <li key={l} className="flex gap-2 leading-relaxed">
                    <span style={{ color: "var(--success)" }}>✓</span> {l}
                  </li>
                ))}
              </ul>
              <Link href={t.href} className={`btn-pixel ${t.featured ? "success" : "ghost"} w-full justify-center`}>{t.cta}</Link>
            </div>
          ))}
        </section>

        <section>
          <h2 className="font-pixel text-2xl mb-2 tracking-wider">Add-ons.</h2>
          <p className="text-[color:var(--muted)] mb-4">Pay-as-you-go on top of any tier.</p>
          <div className="grid sm:grid-cols-3 gap-4">
            {addons.map((a) => (
              <div key={a.name} className="card-pixel">
                <h3 className="font-pixel text-sm mb-1" style={{ color: "var(--accent)" }}>{a.name}</h3>
                <p className="text-xs text-[color:var(--muted)] mb-2">{a.desc}</p>
                <div className="font-mono text-xs" style={{ color: "var(--fg)" }}>{a.price}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card-pixel" style={{ borderColor: "var(--accent)" }}>
          <h2 className="font-pixel text-xl mb-2 tracking-wider" style={{ color: "var(--accent)" }}>Hackathon special.</h2>
          <p className="text-[color:var(--muted)] mb-4">
            All HydraDB hackathon participants get <span style={{ color: "var(--accent)" }}>Pro free for 6 months</span> if DelOS inspires their submission.
            Mention <code>@delrio</code> in your demo and DM the team on the hackathon Discord.
          </p>
          <a href="https://discord.gg/UYsxv9PNU" target="_blank" rel="noreferrer" className="btn-pixel">Join hackathon Discord</a>
        </section>

        <section>
          <h2 className="font-pixel text-2xl mb-3 tracking-wider">FAQ.</h2>
          <div className="space-y-2">
            {[
              { q: "Can I really self-host for $0?", a: "Yes. Groq, Mistral, Gemini, HydraDB all have free tiers that comfortably cover personal use. ElevenLabs has 10k chars/mo free; otherwise the app falls back to browser TTS." },
              { q: "What if I exceed free quotas?", a: "Each provider rate-limits gracefully. The orchestrator has Mistral → Gemini failover and cockatiel retry to absorb most of that. For sustained heavy usage, upgrade or BYO key." },
              { q: "Refund policy?", a: "30-day no-questions refund on Pro. Enterprise: annual contract with prorated refund on termination for cause." },
              { q: "Open source?", a: "MIT-licensed. Fork it. Sell your own SaaS on top. We just ask for attribution." },
            ].map((f) => (
              <details key={f.q} className="card-pixel">
                <summary className="font-pixel text-base tracking-wider cursor-pointer" style={{ color: "var(--accent)" }}>{f.q}</summary>
                <p className="mt-2 text-[color:var(--muted)] text-sm">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t-2 border-[color:var(--surface-2)] py-8 text-center text-xs text-[color:var(--muted)] font-mono">
        Prices indicative · 48h hackathon build · no payment infrastructure yet
      </footer>
    </div>
  );
}
