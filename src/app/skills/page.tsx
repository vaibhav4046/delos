"use client";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { SKILL_MANIFEST, riskColor, type RiskLevel } from "@/lib/skillManifest";

// Public skill catalog · safety surface for judges + developers.
// Every voice/agent intent declared with risk level + approval requirement.
// Read intents fire immediately; external/money/destructive require user tap.

export default function SkillsPage() {
  const skills = Object.values(SKILL_MANIFEST);
  // Group by risk level for visual scan.
  const groups: Record<RiskLevel, typeof skills> = {
    read: [],
    draft: [],
    reversible: [],
    external: [],
    money: [],
    destructive: [],
  };
  for (const s of skills) groups[s.riskLevel].push(s);

  const riskOrder: RiskLevel[] = ["read", "draft", "reversible", "external", "money", "destructive"];
  const riskLabel: Record<RiskLevel, string> = {
    read: "READ · safe",
    draft: "DRAFT · safe",
    reversible: "REVERSIBLE · safe",
    external: "EXTERNAL · approval",
    money: "MONEY · approval",
    destructive: "DESTRUCTIVE · approval",
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/os?guest=1" className="btn-pixel success">★ DelOS</Link>
            <Link href="/scorecard" className="btn-pixel ghost hidden sm:inline-flex">Score</Link>
            <Link href="/docs" className="btn-pixel ghost hidden sm:inline-flex">Docs</Link>
          </nav>
        </div>
      </header>

      <main role="main" aria-label="Skill catalog" className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-6">
        <section>
          <span className="pill pill-muted" style={{ fontSize: 10 }}>★ AGENT SKILLS · SAFETY MANIFEST</span>
          <h1 className="font-pixel text-3xl sm:text-5xl mt-3 mb-3 tracking-wider">
            skills <span style={{ color: "var(--accent)" }}>+ approval</span>.
          </h1>
          <p className="text-[color:var(--muted)] text-sm sm:text-base max-w-3xl leading-relaxed">
            Every voice/agent intent is declared with a risk level. Read-tier intents fire
            instantly. <strong style={{ color: "var(--warn)" }}>External</strong>,{" "}
            <strong style={{ color: "var(--danger)" }}>money</strong>, and{" "}
            <strong style={{ color: "var(--danger)" }}>destructive</strong> intents pause for
            user tap — the agent cannot bypass approval. OpenAI computer-use guidance: on-screen
            instructions are untrusted; the user is the only source of permission.
          </p>
        </section>

        <section className="card-pixel">
          <h2 className="font-pixel text-xs tracking-widest mb-2" style={{ color: "var(--accent)" }}>
            ★ RISK LEVELS
          </h2>
          <ul className="grid sm:grid-cols-2 gap-2 text-xs font-mono">
            <li><span className="pill" style={{ borderColor: "var(--success)", color: "var(--success)", fontSize: 9 }}>READ</span> page reads, recall, listing — no approval</li>
            <li><span className="pill" style={{ borderColor: "var(--success)", color: "var(--success)", fontSize: 9 }}>DRAFT</span> compose mail / forms — no approval, no submit</li>
            <li><span className="pill" style={{ borderColor: "var(--accent)", color: "var(--accent)", fontSize: 9 }}>REVERSIBLE</span> open app, minimize, change theme — no approval</li>
            <li><span className="pill" style={{ borderColor: "var(--warn)", color: "var(--warn)", fontSize: 9 }}>EXTERNAL</span> deploy, send mail, post publicly — <strong>approval</strong></li>
            <li><span className="pill" style={{ borderColor: "var(--danger)", color: "var(--danger)", fontSize: 9 }}>MONEY</span> payment, ticket buy — <strong>approval</strong></li>
            <li><span className="pill" style={{ borderColor: "var(--danger)", color: "var(--danger)", fontSize: 9 }}>DESTRUCTIVE</span> delete data, drop repo — <strong>approval</strong></li>
          </ul>
        </section>

        {riskOrder.map((level) => {
          const list = groups[level];
          if (list.length === 0) return null;
          const color = riskColor(level);
          return (
            <section
              key={level}
              className="card-pixel"
              style={{ borderColor: color, borderLeftWidth: 4 }}
            >
              <h2
                className="font-pixel text-sm tracking-widest mb-3"
                style={{ color }}
              >
                {riskLabel[level]}
              </h2>
              <div className="space-y-2">
                {list.map((s) => (
                  <div
                    key={s.intent}
                    className="flex items-start gap-3 font-mono text-xs leading-relaxed"
                  >
                    <span
                      className="pill"
                      style={{ borderColor: color, color, fontSize: 9, flexShrink: 0, minWidth: 90, justifyContent: "center" }}
                    >
                      {s.intent}
                    </span>
                    <div className="flex-1">
                      <div style={{ color: "var(--fg)" }}>
                        <strong>{s.label}</strong>
                        {s.requiresApproval && (
                          <span className="pill pill-warn ml-2" style={{ fontSize: 9 }}>
                            tap-to-approve
                          </span>
                        )}
                      </div>
                      <div style={{ color: "var(--muted)" }}>{s.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        <section className="card-pixel">
          <h2 className="font-pixel text-xs tracking-widest mb-2" style={{ color: "var(--accent)" }}>
            ★ HOW APPROVAL WORKS
          </h2>
          <ol className="text-xs font-mono leading-relaxed space-y-1 list-decimal pl-5" style={{ color: "var(--fg)" }}>
            <li>Voice agent transcribes user speech → /api/voice-command returns intent + payload</li>
            <li>VoiceApp checks <code>requiresApproval(intent)</code> against the skill manifest</li>
            <li>If required → <code>ApprovalGate</code> modal pops with risk-colored border + payload preview</li>
            <li>User taps ✓ YES → intent dispatches on OS bus. Auto-deny after 60s.</li>
            <li>User taps ✗ NO → bus event suppressed. Voice agent speaks "denied" toast.</li>
            <li>Audit log captures every decision (runLog + HydraDB).</li>
          </ol>
        </section>

        <section className="card-pixel">
          <h2 className="font-pixel text-xs tracking-widest mb-2" style={{ color: "var(--accent)" }}>
            ★ EXTENDING
          </h2>
          <p className="text-xs font-mono leading-relaxed" style={{ color: "var(--muted)" }}>
            Add a new skill: edit <code style={{ color: "var(--fg)" }}>src/lib/skillManifest.ts</code> with{" "}
            <code style={{ color: "var(--fg)" }}>{`{ intent, label, riskLevel, requiresApproval, description }`}</code>.
            Voice command schema picks it up automatically. ApprovalGate renders the
            risk-colored modal without further wiring. Audit log + memory tags happen for free.
          </p>
        </section>

        <div className="text-center pt-2">
          <Link href="/os?guest=1" className="btn-pixel success">▶ TRY GUEST SANDBOX</Link>
        </div>
      </main>
    </div>
  );
}
