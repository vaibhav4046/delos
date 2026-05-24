"use client";
import { useEffect, useState, lazy, Suspense } from "react";
import * as Icons from "lucide-react";
import { onIntent } from "@/lib/intentBus";
import { broadcastAgent } from "@/lib/intentBus";

// Sandpack is ~300KB minified — lazy-load so the OS shell loads fast and
// pays the cost only when the user actually wants to preview a build.
const SandpackPreview = lazy(() => import("./SandpackPreview").then((m) => ({ default: m.SandpackPreview })));

type ProjectFile = {
  path: string;
  content: string;
  language?: string;
};

type Project = {
  name: string;
  description: string;
  stack: string;
  files: ProjectFile[];
  runInstructions?: string;
  notes?: string[];
};

// Codebase viewer — shows a generated multi-file project from /api/codegen-app.
// Two-pane: file tree on the left, file content on the right. Code is monospace
// + syntax-tinted (no full highlighter — keeps bundle small).
export function CodebaseApp() {
  // Default prompt kept short — Groq free tier caps output ~5500 tokens. Long
  // ambitious specs (Uber + map + driver + payment) overflow + return 400
  // json_validate_failed. Users can edit to scope down or use App Builder
  // (constrained DSL) for richer specs.
  const [prompt, setPrompt] = useState("Build a small Uber-style ride-share landing page: hero, how-it-works, mock map block, CTA.");
  const [project, setProject] = useState<Project | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // View modes: FILES (read code) | PREVIEW (run live via Sandpack)
  const [viewMode, setViewMode] = useState<"files" | "preview">("files");

  // Voice intent: { kind: "codebase.build", prompt: "..." }
  useEffect(() => {
    return onIntent("codebase.build" as never, ((i: { prompt: string }) => {
      setPrompt(i.prompt);
      setTimeout(() => generate(i.prompt), 60);
    }) as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate(overridePrompt?: string) {
    const usePrompt = overridePrompt ?? prompt;
    setBusy(true);
    setErr(null);
    setProject(null);
    setSelectedPath(null);
    broadcastAgent("planner", "thinking");
    broadcastAgent("executor", "thinking");
    try {
      const r = await fetch("/api/codegen-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: usePrompt }),
      });
      // Read as text first so we can recover from non-JSON error pages
      // (e.g. Vercel function-timeout HTML which used to throw a raw
      // "Unexpected token 'A', \"An error o...\" is not valid JSON" in the
      // UI). Now we surface a clean message + the first 200 chars of the
      // body so the user sees what actually happened.
      const raw = await r.text();
      let j: { ok?: boolean; project?: Project; error?: string } | null = null;
      try { j = JSON.parse(raw); } catch {}
      if (!r.ok || !j || !j.ok || !j.project) {
        const why = j?.error
          || (r.status === 504
            ? "Codegen timed out — the spec for that prompt is too large. Try a smaller scope (e.g. \"a hero + 4 feature cards\" instead of \"a full SaaS\")."
            : r.status === 429
              ? "Codegen rate-limited. Wait ~60s, then try again."
              : raw.slice(0, 200));
        throw new Error(`HTTP ${r.status} · ${why}`);
      }
      setProject(j.project);
      setSelectedPath(j.project.files[0]?.path ?? null);
      broadcastAgent("critic", "done");
      broadcastAgent("planner", "done");
      broadcastAgent("executor", "done");
    } catch (e) {
      setErr((e as Error).message);
      broadcastAgent("planner", "idle");
      broadcastAgent("executor", "idle");
    } finally {
      setBusy(false);
    }
  }

  // ZIP download intentionally removed — live PREVIEW is the primary "use" path
  // now. Users see the app run in-browser; no need to download + install locally
  // for most demos. Pi handoff section still offers the local-coding-agent path
  // for power users who want full multi-file editing.

  function copyAll() {
    if (!project) return;
    const text = project.files.map((f) => `// ${f.path}\n${f.content}`).join("\n\n");
    navigator.clipboard?.writeText(text);
    window.dispatchEvent(new CustomEvent("toast", { detail: { text: "all files copied", tone: "ok" } }));
  }

  const selected = project?.files.find((f) => f.path === selectedPath) ?? null;

  return (
    <div className="flex flex-col h-full text-xs" style={{ minHeight: 480 }}>
      <div className="p-2 border-b-2" style={{ borderColor: "var(--surface-2)" }}>
        <div className="font-pixel text-sm tracking-wider mb-2" style={{ color: "var(--accent)" }}>
          ★ CODEBASE BUILDER
        </div>
        <p className="text-[10px] font-mono text-[color:var(--muted)] mb-2 leading-relaxed">
          Multi-file React/Next project from a prompt. Files are read-only — copy or download as markdown bundle. Drop into a fresh Next 16 project to run.
        </p>
        <div className="flex gap-2 mb-2">
          <textarea
            className="input-pixel flex-1"
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Build me a Twitter clone with feed + composer + login mock"
            disabled={busy}
          />
        </div>
        <div className="flex flex-wrap gap-1 mb-2">
          {[
            { label: "Amazon", prompt: "Build an Amazon.com home page clone — SAME TO SAME. Top: black header strip with white Amazon logo (left), location selector ('Deliver to Vaibhav · New York'), full-width search bar with category dropdown on left + orange search button on right, account/orders/cart links on right, second nav row with All/Today's Deals/Customer Service/Registry/Gift Cards. Carousel banner. 4 category card rows (Beauty, Computers, Home, Toys). Recommendation rail with 6 product cards (image placeholder, title, 4.5-star rating in orange, price in red with strikethrough original, Prime badge). Bottom: 'Back to top' button, dark blue footer with 4 link columns. Use Amazon brand colors: black #131A22 header, orange #FF9900 buttons, blue #00B5C2 links." },
            { label: "Perplexity", prompt: "Build a Perplexity.ai clone — SAME TO SAME. Dark teal background #0C1A1C. Left sidebar 240px wide: 'New Thread' button at top (turquoise accent), Discover/Library/Spaces tabs with icons, recent threads list (10 mock items), settings + Pro upgrade at bottom. Main center: 'Where knowledge begins' heading at top, huge centered search bar with 'Ask anything…' placeholder + Pro toggle + Focus picker dropdown (Web/Academic/Writing/Wolfram/YouTube/Reddit). Below: 4 example query cards. When answered: question header, AI answer with inline [1][2][3] citation markers in turquoise, 6 source cards on right with title/URL/favicon, related questions chips at bottom, follow-up input. Use Perplexity colors: bg #0C1A1C, accent #20D5D5 turquoise, text #E8E8E8." },
            { label: "ChatGPT", prompt: "Build a ChatGPT clone — SAME TO SAME. Dark gray #212121 sidebar 260px: ChatGPT logo + New Chat button at top, today/yesterday/last 7 days chat history (15 mock chats), user profile pill at bottom (avatar + email + settings cog). Main area: top bar with model selector dropdown (GPT-4o, o1, GPT-3.5), 'ChatGPT' centered logo in empty state with 4 example prompt cards in 2x2 grid. Message thread: alternating user (right-aligned, no avatar) and assistant (left-aligned, OpenAI black-square avatar) bubbles, code blocks in monospace with copy button, regenerate + thumbs up/down + copy on hover. Bottom composer: rounded message input with attach paperclip, mic, and arrow-send button. Token/character counter below. Use ChatGPT colors: bg #2F2F2F dark, accent #10A37F green, hover #4D4D4D." },
            { label: "Claude", prompt: "Build a Claude.ai clone — SAME TO SAME. Cream/off-white background #F2EFE9. Left sidebar 240px in slightly darker cream: Anthropic 'C' logo at top, 'Start new chat' button (orange accent #C96442), Chats heading with 12 conversation history items, Projects section, settings + user profile at bottom. Main panel: centered 'Good morning, Vaibhav' greeting + 4 conversation starter chips in empty state, chat thread with user (cream bubble, right) + assistant (white card, left with bold 'Claude' label) messages, markdown rendering with bold + code blocks. Model picker top-right (Sonnet/Opus/Haiku dropdown). Composer at bottom: tall rounded input with 'Reply to Claude' placeholder, attach + send buttons. Anthropic brand: bg #F2EFE9 cream, accent #C96442 burnt orange, text #2C1810 dark brown, serif headers." },
          ].map((ex) => (
            <button
              key={ex.label}
              onClick={() => !busy && setPrompt(ex.prompt)}
              disabled={busy}
              className="pill pill-muted"
              style={{ fontSize: 9, cursor: busy ? "not-allowed" : "pointer" }}
              title={ex.prompt}
            >
              {ex.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => generate()}
            disabled={busy || prompt.trim().length < 5}
            className="btn-pixel success"
            style={{ fontSize: 11, padding: "6px 12px" }}
          >
            {busy ? "BUILDING…" : "▶ GENERATE"}
          </button>
          {project && (
            <>
              <button onClick={copyAll} className="btn-pixel ghost" style={{ fontSize: 11, padding: "6px 12px" }}>
                <Icons.Copy size={11} /> COPY ALL
              </button>
            </>
          )}
        </div>
        {err && <div className="pill pill-bad mt-2" style={{ fontSize: 10 }}>{err}</div>}
      </div>

      {project && (
        <div className="px-2 py-1 border-b-2 flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: "var(--surface-2)" }}>
          <div className="min-w-0">
            <div className="font-pixel text-xs tracking-wider" style={{ color: "var(--fg)" }}>
              {project.name} <span style={{ color: "var(--muted)" }}>· {project.files.length} files</span>
            </div>
            <p className="text-[10px] font-mono leading-relaxed truncate" style={{ color: "var(--muted)" }}>
              {project.description}
            </p>
          </div>
          {/* View mode toggle: FILES (read code) | PREVIEW (run live in iframe) */}
          <div className="flex items-stretch" style={{ border: "1px solid var(--surface-2)" }}>
            <button
              onClick={() => setViewMode("files")}
              className="font-pixel text-[10px] px-3 py-1 tracking-widest"
              style={{
                background: viewMode === "files" ? "var(--accent)" : "transparent",
                color: viewMode === "files" ? "var(--on-accent)" : "var(--muted)",
                cursor: "pointer",
                border: "none",
              }}
            >
              FILES
            </button>
            <button
              onClick={() => setViewMode("preview")}
              className="font-pixel text-[10px] px-3 py-1 tracking-widest"
              style={{
                background: viewMode === "preview" ? "var(--cyan)" : "transparent",
                color: viewMode === "preview" ? "#001318" : "var(--muted)",
                cursor: "pointer",
                border: "none",
                borderLeft: "1px solid var(--surface-2)",
              }}
            >
              ▶ PREVIEW
            </button>
          </div>
        </div>
      )}

      {/* PREVIEW mode — live Sandpack iframe running the generated app.
         min-height keeps the iframe a real workable height even when the
         host window is shrunk; Sandpack collapses to ~160px otherwise. */}
      {project && viewMode === "preview" && (
        <div className="flex-1 overflow-hidden" style={{ background: "#0b0b14", minHeight: 540 }}>
          <Suspense fallback={<div className="p-4 font-mono text-[10px]" style={{ color: "var(--muted)" }}>booting preview sandbox…</div>}>
            <SandpackPreview project={project} />
          </Suspense>
        </div>
      )}

      {/* FILES mode (default) — file tree + code panel */}
      <div className="flex-1 flex overflow-hidden" style={{ display: viewMode === "files" ? "flex" : "none" }}>
        {/* File tree */}
        <div
          className="overflow-y-auto"
          style={{
            width: 220,
            background: "var(--bg)",
            borderRight: "2px solid var(--surface-2)",
            padding: 6,
          }}
        >
          {!project && !busy && (
            <div className="text-[10px] font-mono text-[color:var(--muted)] p-2">
              No project yet. Generate one.
            </div>
          )}
          {busy && (
            <div className="text-[10px] font-mono text-[color:var(--muted)] p-2 flex items-center gap-1">
              <Icons.Loader2 size={10} className="animate-spin" /> generating multi-file project…
            </div>
          )}
          {project?.files.map((f) => (
            <button
              key={f.path}
              onClick={() => setSelectedPath(f.path)}
              className="w-full text-left font-mono text-[10px] py-1 px-2"
              style={{
                background: selectedPath === f.path ? "var(--surface-2)" : "transparent",
                color: selectedPath === f.path ? "var(--accent)" : "var(--fg)",
                cursor: "pointer",
                border: "none",
                borderLeft: selectedPath === f.path ? "2px solid var(--accent)" : "2px solid transparent",
                wordBreak: "break-all",
              }}
              title={f.path}
            >
              {f.path}
            </button>
          ))}
        </div>

        {/* File content */}
        <div
          className="flex-1 overflow-auto"
          style={{ background: "var(--surface)" }}
        >
          {selected ? (
            <pre
              className="font-mono text-[11px] p-3 whitespace-pre"
              style={{ color: "var(--fg)", margin: 0, minWidth: "min-content" }}
            >
              {selected.content}
            </pre>
          ) : project ? (
            <div className="p-4 text-[color:var(--muted)] font-mono text-[10px]">
              Select a file from the left.
            </div>
          ) : null}
        </div>
      </div>

      {project?.runInstructions && (
        <div
          className="p-2 border-t-2 font-mono text-[10px]"
          style={{ borderColor: "var(--surface-2)", color: "var(--muted)" }}
        >
          <strong style={{ color: "var(--accent)" }}>Run:</strong> {project.runInstructions}
        </div>
      )}

      {project && <PiHandoff project={project} />}
    </div>
  );
}

// "Open in pi" hand-off — DelOS generates the scaffold in-browser; pi (local
// CLI coding agent · @earendil-works/pi-coding-agent · 53k stars · MIT) takes
// over for full multi-file editing, test loop, and deploy. Honest split:
// DelOS = planner / voice layer; pi = local executor.
function PiHandoff({ project }: { project: Project }) {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(label: string, text: string) {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }
  const installCmd = "npm i -g @earendil-works/pi-coding-agent";
  const runCmd = `cd ${project.name} && pi`;
  return (
    <div
      className="p-2 border-t-2 space-y-1"
      style={{ borderColor: "var(--accent)", background: "var(--surface)" }}
    >
      <div className="flex items-center justify-between flex-wrap gap-1">
        <div className="font-pixel text-[10px] tracking-widest" style={{ color: "var(--accent)" }}>
          ★ GRADUATE TO PI · LOCAL CODING AGENT
        </div>
        <a
          href="https://github.com/earendil-works/pi"
          target="_blank"
          rel="noreferrer"
          className="pill pill-muted"
          style={{ fontSize: 9, cursor: "pointer", textDecoration: "none" }}
        >
          ↗ github
        </a>
      </div>
      <p className="text-[10px] font-mono leading-relaxed" style={{ color: "var(--muted)" }}>
        DelOS planned + scaffolded. Pi takes over locally for full multi-file editing, test loop, and deploy. Two-tool combo, not overlap.
      </p>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="pill" style={{ borderColor: "var(--muted)", color: "var(--muted)", fontSize: 9, minWidth: 50, justifyContent: "center" }}>1 · install</span>
          <code
            className="flex-1 font-mono text-[10px] px-2 py-1"
            style={{ background: "var(--bg)", border: "1px solid var(--surface-2)", color: "var(--fg)" }}
          >
            {installCmd}
          </code>
          <button
            onClick={() => copy("install", installCmd)}
            className="pill pill-muted"
            style={{ fontSize: 9, cursor: "pointer" }}
          >
            {copied === "install" ? "✓" : <Icons.Copy size={9} />}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="pill" style={{ borderColor: "var(--muted)", color: "var(--muted)", fontSize: 9, minWidth: 50, justifyContent: "center" }}>2 · save</span>
          <code className="flex-1 font-mono text-[10px] px-2 py-1" style={{ background: "var(--bg)", border: "1px solid var(--surface-2)", color: "var(--fg)" }}>
            click ↓ DOWNLOAD .MD above → drop files into a folder named {project.name}/
          </code>
        </div>
        <div className="flex items-center gap-2">
          <span className="pill" style={{ borderColor: "var(--accent)", color: "var(--accent)", fontSize: 9, minWidth: 50, justifyContent: "center" }}>3 · open</span>
          <code className="flex-1 font-mono text-[10px] px-2 py-1" style={{ background: "var(--bg)", border: "1px solid var(--surface-2)", color: "var(--fg)" }}>
            {runCmd}
          </code>
          <button
            onClick={() => copy("run", runCmd)}
            className="pill pill-muted"
            style={{ fontSize: 9, cursor: "pointer" }}
          >
            {copied === "run" ? "✓" : <Icons.Copy size={9} />}
          </button>
        </div>
      </div>
      <p className="text-[9px] font-mono leading-relaxed" style={{ color: "var(--muted)" }}>
        pi handles the test loop + git + deploy locally. DelOS keeps the voice + planner + cohort + memory layer.
      </p>
    </div>
  );
}
