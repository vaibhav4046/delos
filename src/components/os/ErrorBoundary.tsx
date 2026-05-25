"use client";
import { Component, type ReactNode } from "react";

type State = { hasError: boolean; error?: Error };

export class AppErrorBoundary extends Component<{ children: ReactNode; appName?: string }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    // Log to console only — don't crash whole OS
    // eslint-disable-next-line no-console
    console.error("[delos app crash]", this.props.appName, error);
    // B07 · surface failure as a toast so the user knows the launch failed
    // (instead of staring at a blank window). Toast handler attached at the
    // OS root listens for "toast" custom events.
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              text: `[SYSTEM] Failed to launch ${this.props.appName ?? "app"}`,
              tone: "bad",
            },
          }),
        );
      }
    } catch {}
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-xs h-full flex flex-col items-center justify-center text-center" style={{ background: "var(--surface)" }}>
          <div className="font-pixel text-base tracking-widest mb-2" style={{ color: "var(--danger)" }}>★ APP CRASHED</div>
          <p className="font-mono text-[11px] mb-3" style={{ color: "var(--muted)" }}>
            {this.props.appName ?? "this app"} hit an error
          </p>
          <code className="font-mono text-[10px] mb-3 px-2 py-1 max-w-xs break-all" style={{ background: "var(--bg)", color: "var(--danger)", border: "1px solid var(--surface-2)" }}>
            {this.state.error?.message ?? "unknown error"}
          </code>
          <button
            onClick={() => this.setState({ hasError: false, error: undefined })}
            className="btn-pixel"
            style={{ padding: "6px 12px", fontSize: 11 }}
          >
            ▶ RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
