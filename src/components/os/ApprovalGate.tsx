"use client";
import { useEffect, useState } from "react";
import { getSkill, riskColor, type SkillManifest } from "@/lib/skillManifest";

// ApprovalGate — modal that pops before any voice/agent fires a `requiresApproval`
// intent. User clicks YES → request proceeds. User clicks NO → request aborts.
//
// SECURITY DESIGN:
// - Request side uses a window CustomEvent so any code (voice, agent, future
//   sub-agents) can ask for approval without an import.
// - Decision side does NOT use window events — it uses a private module-level
//   Map of resolvers. A same-origin script that listens for the request event
//   and tries to dispatch its own `delos-approval-decision` can't reach the
//   resolver — only the modal's onClick (which the user must trust by clicking)
//   can call _resolveApproval.
// - The modal click handler also verifies `event.isTrusted` — browsers set this
//   to true only for genuine user gestures, never for `dispatchEvent` from JS.
//   Belt + suspenders.

type PendingApproval = {
  id: string;
  intent: string;
  payload?: string;
  detail?: string;
  skill: SkillManifest;
};

// Private resolver map. Only requestApproval() writes, only the modal's
// click handler reads via _resolveApproval. Closed over module scope, so
// attacker scripts loaded same-origin still can't introspect or call it.
const _resolvers = new Map<string, (approved: boolean) => void>();

function _resolveApproval(id: string, approved: boolean) {
  const r = _resolvers.get(id);
  if (!r) return;
  _resolvers.delete(id);
  r(approved);
}

export function ApprovalGate() {
  const [pending, setPending] = useState<PendingApproval | null>(null);

  useEffect(() => {
    function onRequest(e: Event) {
      const d = (e as CustomEvent).detail as {
        id: string;
        intent: string;
        payload?: string;
        detail?: string;
      };
      if (!d?.intent || !d?.id) return;
      const skill = getSkill(d.intent);
      if (!skill) return;
      setPending({ ...d, skill });
    }
    window.addEventListener("delos-approval-request", onRequest as EventListener);
    return () => window.removeEventListener("delos-approval-request", onRequest as EventListener);
  }, []);

  function decide(approved: boolean, evt: React.MouseEvent | React.KeyboardEvent) {
    if (!pending) return;
    // isTrusted is true only for real browser-dispatched user gestures.
    // Synthetic events from `el.click()` or `dispatchEvent(new MouseEvent…)`
    // are false. Drop them on the floor.
    if (!evt.nativeEvent?.isTrusted) return;
    _resolveApproval(pending.id, approved);
    setPending(null);
  }

  if (!pending) return null;

  const color = riskColor(pending.skill.riskLevel);

  return (
    <div
      className="fixed inset-0 z-[12000] flex items-center justify-center p-4 pointer-events-auto"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card-pixel max-w-md w-full"
        style={{
          background: "var(--surface)",
          borderColor: color,
          boxShadow: `0 8px 0 var(--shadow), 0 0 0 1px ${color}, 0 0 48px ${color}`,
          padding: 20,
        }}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <div
              className="font-pixel text-[10px] tracking-widest"
              style={{ color }}
            >
              ★ APPROVAL · {pending.skill.riskLevel.toUpperCase()}
            </div>
            <div
              className="font-pixel text-lg tracking-wider mt-1"
              style={{ color: "var(--fg)" }}
            >
              {pending.skill.label}?
            </div>
          </div>
        </div>

        <p
          className="font-mono text-[11px] leading-relaxed mb-3"
          style={{ color: "var(--muted)" }}
        >
          {pending.skill.description}
        </p>

        {pending.payload && (
          <div
            className="font-mono text-[11px] mb-3 p-2"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--surface-2)",
              color: "var(--fg)",
              maxHeight: 160,
              overflowY: "auto",
              wordBreak: "break-word",
            }}
          >
            {pending.payload}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={(e) => decide(false, e)}
            className="btn-pixel ghost"
            style={{ fontSize: 12, padding: "8px 14px" }}
            autoFocus
          >
            ✗ NO
          </button>
          <button
            onClick={(e) => decide(true, e)}
            className="btn-pixel success"
            style={{ fontSize: 12, padding: "8px 14px" }}
          >
            ✓ YES — DO IT
          </button>
        </div>

        <p
          className="text-[9px] font-mono mt-3"
          style={{ color: "var(--muted)" }}
        >
          DelOS will not act on this without your tap. Voice agent can&apos;t bypass.
        </p>
      </div>
    </div>
  );
}

// Helper for callers: fire approval request + return a promise that resolves
// to true/false based on user click. Resolver is stored in the private
// _resolvers map; only the modal's trusted-click handler can resolve it.
export function requestApproval(args: {
  intent: string;
  payload?: string;
  detail?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `apr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    _resolvers.set(id, resolve);
    window.dispatchEvent(
      new CustomEvent("delos-approval-request", { detail: { id, ...args } }),
    );
    // Auto-deny after 60s to avoid hangs.
    setTimeout(() => {
      if (_resolvers.has(id)) {
        _resolvers.delete(id);
        resolve(false);
      }
    }, 60_000);
  });
}
