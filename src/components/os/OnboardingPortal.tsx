"use client";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import {
  supportsFsAccess,
  pickDirectory,
  indexDirectory,
  saveIndex,
  syncDigestToServer,
} from "@/lib/desktopIngest";
import { getTenantId, setTenantId } from "@/lib/useTenant";

// OnboardingPortal — retro-futuristic ingest wizard.
// Renders as a full-screen overlay the first time a user opens /os.
// 5 steps: identity → cloud connectors → desktop pick → coordinator preview → done.
// Each step is skippable. AI does the heavy work; user only re-auths where required.

type Step = "welcome" | "identity" | "cloud" | "desktop" | "coordinate" | "done";

const STORE_KEY = "delos.onboarded.v1";

export function hasOnboarded(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(STORE_KEY) === "1";
}

export function markOnboarded() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORE_KEY, "1");
  } catch {}
}

export function OnboardingPortal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const [me, setMe] = useState<{ email?: string; tenantId?: string; signedIn?: boolean }>({});
  const [connectors, setConnectors] = useState<Array<{ id: string; name: string; available: boolean; oauthInit?: string; reason?: string; category: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [desktopRoot, setDesktopRoot] = useState<string | null>(null);
  const [desktopCount, setDesktopCount] = useState<number>(0);
  const [coordinatorPlan, setCoordinatorPlan] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => {
      setMe(d);
      if (d?.tenantId) {
        setTenantId(d.tenantId);
      }
    }).catch(() => {});
    fetch("/api/connectors").then((r) => r.json()).then((d) => setConnectors(d.connectors ?? [])).catch(() => {});
  }, []);

  async function connectDesktop() {
    if (!supportsFsAccess()) return;
    setBusy(true);
    try {
      const handle = await pickDirectory();
      if (!handle) return;
      const indexed = await indexDirectory(handle);
      setDesktopRoot(handle.name);
      setDesktopCount(indexed.length);
      saveIndex(handle.name, indexed);
      await syncDigestToServer(handle.name, indexed, getTenantId() ?? me.tenantId ?? "delrio_demo");
    } finally {
      setBusy(false);
    }
  }

  async function runCoordinator() {
    setBusy(true);
    try {
      const r = await fetch("/api/coordinator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: "Organize my workspace given what you can see — files, connectors, identity. Propose 5 quick wins I can act on now.",
          tenantId: me.tenantId,
        }),
      });
      const j = (await r.json()) as { ok?: boolean; plan?: { summary: string; rationale: string; actions: Array<{ kind: string; detail: string }> } };
      if (j.ok && j.plan) {
        const lines = [
          `▸ ${j.plan.summary}`,
          `   ${j.plan.rationale.slice(0, 200)}`,
          ...j.plan.actions.slice(0, 5).map((a) => `   · [${a.kind}] ${a.detail.slice(0, 100)}`),
        ];
        setCoordinatorPlan(lines.join("\n"));
      }
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    markOnboarded();
    onClose();
  }

  const steps: Step[] = ["welcome", "identity", "cloud", "desktop", "coordinate", "done"];
  const stepIdx = steps.indexOf(step);

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{
        background: "rgba(15,15,27,0.92)",
        backdropFilter: "blur(20px) saturate(160%)",
      }}
      role="dialog"
      aria-modal="true"
    >
      {/* Retro CRT scanlines overlay */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent 0 2px, rgba(123,123,153,0.04) 2px 3px), radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.4) 100%)",
        }}
      />
      <div
        className="relative card-pixel w-full max-w-2xl"
        style={{
          padding: 28,
          background: "var(--surface)",
          borderWidth: 2,
          borderColor: "var(--accent)",
          boxShadow: "6px 6px 0 rgba(0,0,0,0.4), 0 0 60px rgba(251,197,49,0.12)",
        }}
      >
        {/* Header bar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Icons.Sparkles size={18} color="var(--accent)" className="animate-pulse" />
            <span className="font-pixel text-base tracking-widest" style={{ color: "var(--accent)" }}>
              ★ DELOS PORTAL · INGEST &amp; ORGANIZE
            </span>
          </div>
          <button onClick={finish} className="font-mono text-xs" style={{ color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer" }} aria-label="Close onboarding">
            skip →
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-5">
          {steps.map((s, i) => (
            <div
              key={s}
              className="h-1 flex-1 transition-all"
              style={{
                background: i <= stepIdx ? "var(--accent)" : "var(--surface-2)",
                boxShadow: i === stepIdx ? "0 0 8px var(--accent)" : "none",
              }}
            />
          ))}
        </div>

        {/* Step bodies */}
        {step === "welcome" && (
          <div className="space-y-3">
            <h2 className="font-pixel text-2xl tracking-wider" style={{ color: "var(--fg)" }}>
              welcome to delos.
            </h2>
            <p className="font-mono text-sm" style={{ color: "var(--muted)" }}>
              {me.signedIn ? `signed in as ${me.email}` : "guest mode — sign in to sync across devices"}
            </p>
            <p className="font-mono text-xs leading-relaxed" style={{ color: "var(--fg)" }}>
              this portal walks you through bringing your context into the os. agents read it, organize it, recall it across runs. nothing leaves your browser unless you connect a cloud source. each step is optional, takes 10 seconds, can be redone later from the ingest app.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-4">
              {[
                { icon: "User", label: "Identity", desc: "Who you are, how agents should respond." },
                { icon: "Cloud", label: "Cloud", desc: "Notion, Gmail, Drive, Slack." },
                { icon: "HardDrive", label: "Desktop", desc: "Local files via browser picker." },
                { icon: "Cpu", label: "Coordinate", desc: "Let AI propose first moves." },
              ].map((card) => {
                const I = (Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[card.icon] ?? Icons.Box;
                return (
                  <div key={card.label} className="card-pixel" style={{ padding: 8 }}>
                    <div className="flex items-center gap-1.5">
                      <I size={12} color="var(--accent)" />
                      <span className="font-pixel text-[11px] tracking-wider">{card.label}</span>
                    </div>
                    <p className="font-mono text-[10px] mt-1" style={{ color: "var(--muted)" }}>{card.desc}</p>
                  </div>
                );
              })}
            </div>
            <button onClick={() => setStep("identity")} className="btn-pixel success w-full mt-4" style={{ padding: "10px 16px", fontSize: 12 }}>
              ▶ begin · {stepIdx + 1} of {steps.length - 1}
            </button>
          </div>
        )}

        {step === "identity" && (
          <div className="space-y-3">
            <h2 className="font-pixel text-xl tracking-wider" style={{ color: "var(--accent)" }}>
              [01] identity
            </h2>
            <p className="font-mono text-xs" style={{ color: "var(--muted)" }}>
              tell the os who you are so every agent output matches your voice. opens the identity app — fill it in then come back.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "identity" } }));
                  setStep("cloud");
                }}
                className="btn-pixel success"
                style={{ padding: "8px 12px", fontSize: 11 }}
              >
                open identity app →
              </button>
              <button onClick={() => setStep("cloud")} className="btn-pixel ghost" style={{ padding: "8px 12px", fontSize: 11 }}>
                skip
              </button>
            </div>
          </div>
        )}

        {step === "cloud" && (
          <div className="space-y-3">
            <h2 className="font-pixel text-xl tracking-wider" style={{ color: "var(--accent)" }}>
              [02] cloud connectors
            </h2>
            <p className="font-mono text-xs" style={{ color: "var(--muted)" }}>
              click any connector to start oauth. tokens stored encrypted in hydradb, scoped to your tenant. no content cached server-side.
            </p>
            <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
              {connectors.map((c) => (
                <div
                  key={c.id}
                  className="card-pixel"
                  style={{
                    padding: 6,
                    borderColor: c.available ? "var(--success)" : "var(--surface-2)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-pixel text-[10px] tracking-wider">{c.name}</span>
                    <span className="pill" style={{ fontSize: 8, background: c.available ? "var(--success)" : "var(--surface-2)", color: c.available ? "var(--on-accent)" : "var(--muted)" }}>
                      {c.available ? "live" : "off"}
                    </span>
                  </div>
                  {c.oauthInit && !c.available && (
                    <a href={c.oauthInit} target="_blank" rel="noreferrer" className="font-mono text-[10px] mt-1 inline-block" style={{ color: "var(--accent)" }}>
                      connect →
                    </a>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep("desktop")} className="btn-pixel success" style={{ padding: "8px 12px", fontSize: 11 }}>
                next · desktop →
              </button>
              <button onClick={() => setStep("desktop")} className="btn-pixel ghost" style={{ padding: "8px 12px", fontSize: 11 }}>
                skip
              </button>
            </div>
          </div>
        )}

        {step === "desktop" && (
          <div className="space-y-3">
            <h2 className="font-pixel text-xl tracking-wider" style={{ color: "var(--accent)" }}>
              [03] desktop files
            </h2>
            <p className="font-mono text-xs" style={{ color: "var(--muted)" }}>
              pick any folder — desktop, downloads, a project root. delos indexes file names + tiny text previews locally. agents recall them as context. file content NEVER leaves your machine.
            </p>
            {desktopRoot ? (
              <div className="card-pixel" style={{ borderColor: "var(--success)", padding: 8 }}>
                <p className="font-mono text-xs" style={{ color: "var(--success)" }}>
                  ✓ indexed {desktopCount} files from {desktopRoot}
                </p>
              </div>
            ) : !supportsFsAccess() ? (
              <p className="font-mono text-xs" style={{ color: "var(--warn)" }}>
                browser does not support directory picker. use chrome / edge / opera. skip for now.
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                onClick={connectDesktop}
                disabled={busy || !supportsFsAccess()}
                className="btn-pixel success"
                style={{ padding: "8px 12px", fontSize: 11 }}
              >
                {busy ? "indexing…" : desktopRoot ? "re-index" : "▶ pick folder"}
              </button>
              <button onClick={() => setStep("coordinate")} className="btn-pixel" style={{ padding: "8px 12px", fontSize: 11 }}>
                next · coordinate →
              </button>
              <button onClick={() => setStep("coordinate")} className="btn-pixel ghost" style={{ padding: "8px 12px", fontSize: 11 }}>
                skip
              </button>
            </div>
          </div>
        )}

        {step === "coordinate" && (
          <div className="space-y-3">
            <h2 className="font-pixel text-xl tracking-wider" style={{ color: "var(--accent)" }}>
              [04] let ai coordinate
            </h2>
            <p className="font-mono text-xs" style={{ color: "var(--muted)" }}>
              the coordinator reads everything you ingested + your identity, then proposes concrete next moves. takes ~5 seconds.
            </p>
            {coordinatorPlan ? (
              <pre className="font-mono text-[10px] whitespace-pre-wrap" style={{ background: "var(--bg)", padding: 10, color: "var(--success)", maxHeight: 240, overflowY: "auto" }}>
                {coordinatorPlan}
              </pre>
            ) : null}
            <div className="flex gap-2">
              <button onClick={runCoordinator} disabled={busy} className="btn-pixel success" style={{ padding: "8px 12px", fontSize: 11 }}>
                {busy ? "thinking…" : coordinatorPlan ? "re-run" : "▶ ask the coordinator"}
              </button>
              <button onClick={() => setStep("done")} className="btn-pixel" style={{ padding: "8px 12px", fontSize: 11 }}>
                next →
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-3">
            <h2 className="font-pixel text-2xl tracking-wider" style={{ color: "var(--success)" }}>
              ✓ portal complete.
            </h2>
            <p className="font-mono text-sm" style={{ color: "var(--fg)" }}>
              tenantId: <span style={{ color: "var(--accent)" }}>{me.tenantId ?? "delrio_demo"}</span>
            </p>
            <p className="font-mono text-xs" style={{ color: "var(--muted)" }}>
              your workspace is scoped. memory is per-user. agents read your identity + ingest + cloud sources every run. re-open this portal anytime from the ingest app or by clicking the portal icon in the dock.
            </p>
            <button onClick={finish} className="btn-pixel success w-full" style={{ padding: "12px 18px", fontSize: 13 }}>
              ▶ enter delos
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
