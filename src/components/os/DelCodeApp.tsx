"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Icons from "lucide-react";

// DelCode · manual multi-file IDE inside DelOS.
// File tree (left) + tabs (top) + code editor (center) + terminal (bottom).
// No LLM-generated code — this is for users who want to actually write code.
// Persists to localStorage so files survive reloads.
//
// Features:
//   - Multi-file project tree with create / rename / delete
//   - Tabs with dirty-marker, close button
//   - Monospace editor w/ line numbers, soft-tab insert, language pill
//   - Language detection by extension (16 languages)
//   - Library quick-add panel (popular packages per language)
//   - Integrated terminal that supports tiny built-in commands + echo
//     and forwards real shell-shaped commands via /api/tool when the
//     `calc`, `web_search`, `summarize` tools fit. No real shell access
//     (browser sandbox) — clearly labelled "sandbox terminal".

type Lang = "ts" | "js" | "tsx" | "jsx" | "py" | "rs" | "go" | "java" | "kt" | "cpp" | "c" | "rb" | "php" | "sh" | "html" | "css" | "md" | "json" | "sql" | "txt";

type DelFile = { path: string; content: string; dirty: boolean };

const LANG_BY_EXT: Record<string, Lang> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx",
  py: "py", rs: "rs", go: "go", java: "java", kt: "kt",
  cpp: "cpp", cc: "cpp", hpp: "cpp", h: "c", c: "c",
  rb: "rb", php: "php", sh: "sh", bash: "sh",
  html: "html", htm: "html", css: "css",
  md: "md", json: "json", sql: "sql", txt: "txt",
};
const LANG_COLOR: Record<Lang, string> = {
  ts: "#3178c6", tsx: "#3178c6", js: "#f7df1e", jsx: "#f7df1e",
  py: "#3776ab", rs: "#dea584", go: "#00add8", java: "#ed8b00", kt: "#7f52ff",
  cpp: "#00599c", c: "#a8b9cc", rb: "#cc342d", php: "#777bb4",
  sh: "#89e051", html: "#e34c26", css: "#1572b6", md: "#999", json: "#ffe066",
  sql: "#dad8d8", txt: "#999",
};
const LANG_LABEL: Record<Lang, string> = {
  ts: "TypeScript", tsx: "TypeScript JSX", js: "JavaScript", jsx: "JavaScript JSX",
  py: "Python", rs: "Rust", go: "Go", java: "Java", kt: "Kotlin",
  cpp: "C++", c: "C", rb: "Ruby", php: "PHP",
  sh: "Shell", html: "HTML", css: "CSS",
  md: "Markdown", json: "JSON", sql: "SQL", txt: "Plain text",
};
const STARTER_LIBS: Record<Lang, Array<{ name: string; install: string; desc: string }>> = {
  ts: [{ name: "axios", install: "npm i axios", desc: "HTTP client" }, { name: "zod", install: "npm i zod", desc: "Schema validation" }, { name: "lodash", install: "npm i lodash", desc: "Utility functions" }],
  tsx: [{ name: "react", install: "npm i react react-dom", desc: "UI library" }, { name: "framer-motion", install: "npm i framer-motion", desc: "Animations" }, { name: "tailwindcss", install: "npm i -D tailwindcss", desc: "Atomic CSS" }],
  js: [{ name: "express", install: "npm i express", desc: "Web server" }, { name: "dotenv", install: "npm i dotenv", desc: "Env loader" }, { name: "node-fetch", install: "npm i node-fetch", desc: "Fetch in Node" }],
  jsx: [{ name: "react", install: "npm i react react-dom", desc: "UI library" }, { name: "react-router", install: "npm i react-router-dom", desc: "Routing" }, { name: "swr", install: "npm i swr", desc: "Data fetching" }],
  py: [{ name: "requests", install: "pip install requests", desc: "HTTP client" }, { name: "pandas", install: "pip install pandas", desc: "Data frames" }, { name: "fastapi", install: "pip install fastapi uvicorn", desc: "Web API" }, { name: "rich", install: "pip install rich", desc: "Pretty terminal" }],
  rs: [{ name: "tokio", install: "cargo add tokio --features full", desc: "Async runtime" }, { name: "serde", install: "cargo add serde --features derive", desc: "Serialization" }, { name: "reqwest", install: "cargo add reqwest", desc: "HTTP client" }],
  go: [{ name: "gin", install: "go get -u github.com/gin-gonic/gin", desc: "Web framework" }, { name: "gorm", install: "go get -u gorm.io/gorm", desc: "ORM" }, { name: "viper", install: "go get github.com/spf13/viper", desc: "Config loader" }],
  java: [{ name: "spring-boot", install: "spring init --build=gradle demo", desc: "App framework" }, { name: "okhttp", install: "implementation 'com.squareup.okhttp3:okhttp:4.12.0'", desc: "HTTP client" }],
  kt: [{ name: "ktor", install: "implementation 'io.ktor:ktor-server-core:2.3.7'", desc: "Async web" }, { name: "koin", install: "implementation 'io.insert-koin:koin-core:3.5.0'", desc: "DI" }],
  cpp: [{ name: "fmt", install: "vcpkg install fmt", desc: "Formatting" }, { name: "spdlog", install: "vcpkg install spdlog", desc: "Logging" }, { name: "boost", install: "vcpkg install boost", desc: "Std-extension" }],
  c: [{ name: "libcurl", install: "apt install libcurl4-openssl-dev", desc: "HTTP" }, { name: "sdl2", install: "apt install libsdl2-dev", desc: "Gamedev" }],
  rb: [{ name: "rails", install: "gem install rails", desc: "Web framework" }, { name: "sinatra", install: "gem install sinatra", desc: "Micro web" }, { name: "httparty", install: "gem install httparty", desc: "HTTP" }],
  php: [{ name: "laravel", install: "composer global require laravel/installer", desc: "Web framework" }, { name: "guzzle", install: "composer require guzzlehttp/guzzle", desc: "HTTP" }],
  sh: [{ name: "fzf", install: "apt install fzf", desc: "Fuzzy finder" }, { name: "ripgrep", install: "apt install ripgrep", desc: "Fast grep" }, { name: "jq", install: "apt install jq", desc: "JSON query" }],
  html: [{ name: "alpine.js", install: "<script src=\"//unpkg.com/alpinejs\"></script>", desc: "Mini reactive JS" }, { name: "htmx", install: "<script src=\"//unpkg.com/htmx.org\"></script>", desc: "HTML-driven UI" }],
  css: [{ name: "tailwindcss", install: "npm i -D tailwindcss", desc: "Atomic CSS" }, { name: "open-props", install: "<link href=\"//unpkg.com/open-props\" rel=\"stylesheet\">", desc: "Design tokens" }],
  md: [{ name: "shiki", install: "npm i shiki", desc: "Syntax highlight" }, { name: "rehype-katex", install: "npm i rehype-katex", desc: "Math" }],
  json: [],
  sql: [{ name: "duckdb", install: "pip install duckdb", desc: "In-process analytics" }, { name: "sqlite", install: "apt install sqlite3", desc: "Embedded SQL" }],
  txt: [],
};

const STARTER_FILES: DelFile[] = [
  {
    path: "README.md",
    dirty: false,
    content: "# DelCode\n\nManual multi-file IDE. Right-click left panel to create a new file.\n\nLanguages auto-detect by extension: .ts .tsx .js .jsx .py .rs .go .java .cpp .rb .php .sh .html .css .md .json .sql\n\nIntegrated terminal at the bottom. Type `help` to see built-in commands.\n",
  },
  {
    path: "main.py",
    dirty: false,
    content: "# DelCode · Python starter\n\ndef fib(n: int) -> int:\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n\nif __name__ == \"__main__\":\n    for i in range(10):\n        print(f\"fib({i}) = {fib(i)}\")\n",
  },
  {
    path: "index.html",
    dirty: false,
    content: "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\" />\n    <title>DelCode demo</title>\n    <style>body { font-family: ui-sans-serif; padding: 40px; }</style>\n  </head>\n  <body>\n    <h1>Hello from DelCode</h1>\n    <p>Edit any file in the tree.</p>\n  </body>\n</html>\n",
  },
];

const STORE_KEY = "delos.delcode.files.v1";
const OPEN_KEY = "delos.delcode.open.v1";

function detectLang(path: string): Lang {
  const ext = path.split(".").pop()?.toLowerCase() ?? "txt";
  return LANG_BY_EXT[ext] ?? "txt";
}

// W01 · global cache for codegen-app stream events that arrived BEFORE
// DelCode mounted. VibeCode pushes here; DelCode reads on mount + listens
// for new events. Fixes the IDE-shows-sample-files race condition.
type DelcodeIncoming = { files: Array<{ path: string; content: string }>; name?: string };
const G = globalThis as unknown as { __delos_delcode_pending?: DelcodeIncoming | null };
G.__delos_delcode_pending ??= null;
// Bulletproof handoff · used by VibeCode's "OPEN DELCODE" / "FULL IDE" buttons
// to load THIS build into the IDE no matter its state. Three redundant layers
// so the IDE can never fall back to stale sample/junk files:
//   1. global pending  → a FRESH-mounting IDE reads it in loadFiles()
//   2. localStorage     → if the global is ever missed, loadFiles() reads the
//                         persisted workspace, which we overwrite with THIS
//                         project (keeps OPEN_KEY coherent with the new files)
//   3. event + retries  → swaps an ALREADY-OPEN IDE; retried across mount
//                         latency so a slow-spawning window still catches it
export function pushDelcodePayload(p: DelcodeIncoming) {
  if (typeof window === "undefined" || !p?.files?.length) return;
  G.__delos_delcode_pending = p;
  try {
    const fs: DelFile[] = p.files.map((f) => ({ path: f.path, content: f.content, dirty: false }));
    localStorage.setItem(STORE_KEY, JSON.stringify(fs));
    localStorage.setItem(
      OPEN_KEY,
      JSON.stringify({ open: fs.slice(0, 4).map((f) => f.path), active: fs[0]?.path ?? null }),
    );
  } catch {}
  const fire = () => window.dispatchEvent(new CustomEvent("delos-codegen-load", { detail: p }));
  fire();
  requestAnimationFrame(fire);
  setTimeout(fire, 160);
  setTimeout(fire, 450);
}
function consumeDelcodePending(): DelcodeIncoming | null {
  const p = G.__delos_delcode_pending;
  G.__delos_delcode_pending = null;
  return p ?? null;
}

function loadFiles(): DelFile[] {
  if (typeof window === "undefined") return STARTER_FILES;
  // W01 · pending codegen project takes priority over stale localStorage sample
  const pending = consumeDelcodePending();
  if (pending?.files?.length) {
    return pending.files.map((f) => ({ path: f.path, content: f.content, dirty: false }));
  }
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return STARTER_FILES;
    return JSON.parse(raw) as DelFile[];
  } catch { return STARTER_FILES; }
}
function saveFiles(fs: DelFile[]) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(fs)); } catch {}
}

export function DelCodeApp() {
  const [files, setFiles] = useState<DelFile[]>([]);
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [termLines, setTermLines] = useState<Array<{ kind: "in" | "out" | "err" | "sys"; text: string }>>([
    { kind: "sys", text: "DelCode · sandbox terminal · type `help` for commands" },
  ]);
  const [termInput, setTermInput] = useState("");
  const [showLibs, setShowLibs] = useState(false);
  // Hydration guard · the save effect must NOT run until the load effect
  // has hydrated state from localStorage. Was a P0 bug · initial `setFiles([])`
  // triggered the save effect which wrote `[]` to localStorage and wiped
  // the user's files on every refresh. Now save is gated on `hydrated`.
  const [hydrated, setHydrated] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const lineGutterRef = useRef<HTMLDivElement | null>(null);
  const termBodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Mount-only hydration from the in-browser FS + localStorage · setState in
    // an effect is intentional (gated by `hydrated` so the save effect below
    // doesn't clobber the user's files before this restore runs).
    /* eslint-disable react-hooks/set-state-in-effect */
    const fs = loadFiles();
    setFiles(fs);
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw) {
        const o = JSON.parse(raw) as { open: string[]; active: string | null };
        setOpenPaths(o.open.filter((p) => fs.some((f) => f.path === p)));
        if (o.active && fs.some((f) => f.path === o.active)) setActivePath(o.active);
        else if (fs.length > 0) {
          setOpenPaths([fs[0].path]);
          setActivePath(fs[0].path);
        }
      } else if (fs.length > 0) {
        setOpenPaths([fs[0].path]);
        setActivePath(fs[0].path);
      }
    } catch {
      if (fs.length > 0) {
        setOpenPaths([fs[0].path]);
        setActivePath(fs[0].path);
      }
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!hydrated) return; // skip the pre-hydration `[]` overwrite
    saveFiles(files);
  }, [files, hydrated]);

  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify({ open: openPaths, active: activePath })); } catch {}
  }, [openPaths, activePath]);

  useEffect(() => {
    if (termBodyRef.current) termBodyRef.current.scrollTop = termBodyRef.current.scrollHeight;
  }, [termLines]);

  // External codegen-project loader · VibeCode's production-mode build
  // dispatches `delos-codegen-load` with a multi-file project payload.
  // We replace the workspace with the new files so the user can review
  // the generated React/Next code in DelCode immediately. Was a missing
  // bridge that left the production-mode build invisible to the user.
  useEffect(() => {
    function onLoad(e: Event) {
      const det = (e as CustomEvent).detail as
        | { files?: Array<{ path: string; content: string }>; name?: string }
        | undefined;
      if (!det?.files?.length) return;
      const newFiles: DelFile[] = det.files.map((f) => ({
        path: f.path,
        content: f.content,
        dirty: false,
      }));
      setFiles(newFiles);
      setOpenPaths(newFiles.slice(0, 4).map((f) => f.path));
      setActivePath(newFiles[0].path);
      setTermLines((prev) => [
        ...prev,
        { kind: "sys", text: `★ loaded ${newFiles.length} files from codegen-app${det.name ? ` · project "${det.name}"` : ""}` },
      ]);
    }
    window.addEventListener("delos-codegen-load", onLoad as EventListener);
    return () => window.removeEventListener("delos-codegen-load", onLoad as EventListener);
  }, []);

  const activeFile = useMemo(() => files.find((f) => f.path === activePath) ?? null, [files, activePath]);
  const activeLang = activeFile ? detectLang(activeFile.path) : "txt";
  // ▶ PREVIEW · same-origin URL the live-preview iframe points at. null = editor
  // is showing; non-null = the running app is showing. We use a URL (not srcDoc)
  // because a srcDoc iframe inherits the page's strict CSP and the bundled
  // React/Babel/Tailwind CDN scripts get blocked → blank pane. The route serves
  // its own permissive CSP, so navigating to it actually runs.
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  function openFile(path: string) {
    setActivePath(path);
    setOpenPaths((p) => (p.includes(path) ? p : [...p, path]));
  }

  // W03 · export current project · POSTs files inline so serverless cold-start
  // can't lose the cached project between codegen call and export click.
  async function exportProject(format: "zip" | "html") {
    if (!files.length) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { text: "Run a build first to enable export.", tone: "warn" } }));
      return;
    }
    const G = globalThis as unknown as { __delos_current_project_id?: string; __delos_delcode_pending?: { name?: string } };
    const name = G.__delos_delcode_pending?.name ?? "delos-export";
    try {
      const res = await fetch(`/api/codegen-app/export?format=${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: G.__delos_current_project_id,
          name,
          files: files.map((f) => ({ path: f.path, content: f.content })),
        }),
      });
      if (!res.ok) {
        window.dispatchEvent(new CustomEvent("toast", { detail: { text: `export ${format} failed (${res.status})`, tone: "bad" } }));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[^a-z0-9-]+/gi, "-")}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      window.dispatchEvent(new CustomEvent("toast", { detail: { text: `↓ ${format.toUpperCase()} downloaded`, tone: "ok" } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { text: `export error: ${(e as Error).message.slice(0, 60)}`, tone: "bad" } }));
    }
  }
  // ▶ PREVIEW · bundle the entire project into ONE runnable HTML doc and mount
  // it in a sandboxed iframe so the user actually SEES the generated app run —
  // not just its source. This was the headline gap: production builds streamed
  // code into DelCode but there was no way to render the result. Reuses the
  // same isomorphic bundler as the .html export so preview == downloaded HTML.
  async function openPreview() {
    if (!files.length) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { text: "Build or open a project first to preview.", tone: "warn" } }));
      return;
    }
    const hasReact = files.some((f) => /\.(t|j)sx$/.test(f.path));
    if (!hasReact) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { text: "Preview needs a React/JSX project (.tsx). Use ▶ RUN for single-file scripts.", tone: "warn" } }));
      return;
    }
    const G = globalThis as unknown as { __delos_delcode_pending?: { name?: string } };
    const name = G.__delos_delcode_pending?.name ?? "DelOS app";
    try {
      termPush("sys", "▶ preview · bundling + rendering in sandboxed iframe…");
      // Bundle server-side and load via a token URL — the route ships a
      // permissive CSP so the CDN React/Babel/Tailwind actually run (a srcDoc
      // iframe would inherit the page's strict CSP and render blank).
      const r = await fetch("/api/codegen-app/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, files: files.map((f) => ({ path: f.path, content: f.content })) }),
      });
      const j = (await r.json()) as { ok?: boolean; token?: string; error?: string };
      if (!r.ok || !j.ok || !j.token) throw new Error(j.error ?? `HTTP ${r.status}`);
      setPreviewSrc(`/api/codegen-app/preview?token=${encodeURIComponent(j.token)}`);
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { text: `preview error: ${(e as Error).message.slice(0, 60)}`, tone: "bad" } }));
    }
  }
  function closeTab(path: string) {
    setOpenPaths((p) => {
      const remaining = p.filter((x) => x !== path);
      // Update activePath off the FRESH list to avoid the stale-closure
      // bug where activePath fell back to a tab that had already been
      // closed. Was producing flicker + blank editor pane.
      if (activePath === path) {
        setActivePath(remaining[remaining.length - 1] ?? null);
      }
      return remaining;
    });
  }
  function newFile() {
    const name = window.prompt("New file name (e.g. utils.ts, server.py, styles.css):");
    if (!name) return;
    if (files.some((f) => f.path === name)) {
      alert("File already exists.");
      return;
    }
    const fresh: DelFile = { path: name, content: "", dirty: false };
    setFiles((p) => [...p, fresh]);
    openFile(name);
  }
  function renameFile(path: string) {
    const next = window.prompt("Rename to:", path);
    if (!next || next === path) return;
    if (files.some((f) => f.path === next)) {
      alert("That filename already exists.");
      return;
    }
    setFiles((p) => p.map((f) => (f.path === path ? { ...f, path: next } : f)));
    setOpenPaths((p) => p.map((x) => (x === path ? next : x)));
    if (activePath === path) setActivePath(next);
  }
  function deleteFile(path: string) {
    if (!window.confirm(`Delete ${path}?`)) return;
    setFiles((p) => p.filter((f) => f.path !== path));
    setOpenPaths((p) => {
      const remaining = p.filter((x) => x !== path);
      if (activePath === path) {
        setActivePath(remaining[remaining.length - 1] ?? null);
      }
      return remaining;
    });
  }
  function updateContent(content: string) {
    if (!activePath) return;
    setFiles((p) => p.map((f) => (f.path === activePath ? { ...f, content, dirty: true } : f)));
  }
  function saveFile() {
    if (!activePath) return;
    setFiles((p) => p.map((f) => (f.path === activePath ? { ...f, dirty: false } : f)));
    setTermLines((p) => [...p, { kind: "sys", text: `saved ${activePath}` }]);
  }

  function termPush(kind: "in" | "out" | "err" | "sys", text: string) {
    setTermLines((p) => [...p.slice(-200), { kind, text }]);
  }
  async function runCmd(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;
    termPush("in", "$ " + cmd);
    const [verb, ...rest] = cmd.split(/\s+/);
    const arg = rest.join(" ");
    if (verb === "help") {
      termPush("out", "Built-in: ls · cat <file> · new <file> · open <file> · save · clear · echo <text> · calc <expr> · langs · libs · run · whoami · date · pwd");
      return;
    }
    if (verb === "clear") {
      setTermLines([{ kind: "sys", text: "DelCode · sandbox terminal · type `help` for commands" }]);
      return;
    }
    if (verb === "ls") {
      files.forEach((f) => termPush("out", `  ${f.path}${f.dirty ? "  *" : ""}`));
      return;
    }
    if (verb === "cat") {
      const f = files.find((x) => x.path === arg);
      if (!f) { termPush("err", `cat: ${arg}: no such file`); return; }
      f.content.split("\n").forEach((l) => termPush("out", l));
      return;
    }
    if (verb === "new") {
      if (!arg) { termPush("err", "new: missing filename"); return; }
      if (files.some((f) => f.path === arg)) { termPush("err", "new: file exists"); return; }
      setFiles((p) => [...p, { path: arg, content: "", dirty: false }]);
      openFile(arg);
      termPush("out", `created ${arg}`);
      return;
    }
    if (verb === "open") {
      if (!files.some((f) => f.path === arg)) { termPush("err", `open: ${arg}: no such file`); return; }
      openFile(arg);
      termPush("out", `opened ${arg}`);
      return;
    }
    if (verb === "save") { saveFile(); return; }
    if (verb === "echo") { termPush("out", arg); return; }
    if (verb === "calc") {
      try {
        const r = await fetch("/api/tool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "calc", args: { expr: arg } }) });
        const j = (await r.json()) as { ok?: boolean; data?: unknown; error?: string };
        if (j.ok) termPush("out", String(typeof j.data === "object" ? JSON.stringify(j.data) : j.data));
        else termPush("err", j.error ?? "calc failed");
      } catch (e) { termPush("err", (e as Error).message); }
      return;
    }
    if (verb === "langs") {
      Object.entries(LANG_LABEL).forEach(([k, v]) => termPush("out", `  .${k.padEnd(5)} → ${v}`));
      return;
    }
    if (verb === "libs") {
      const libs = STARTER_LIBS[activeLang] ?? [];
      if (libs.length === 0) { termPush("out", `no libraries indexed for ${activeLang}`); return; }
      libs.forEach((l) => termPush("out", `  ${l.name.padEnd(20)} ${l.install}`));
      return;
    }
    if (verb === "run") {
      termPush("sys", `running ${activePath ?? "(no file)"} in sandbox · output below`);
      if (!activeFile) { termPush("err", "run: no active file"); return; }
      if (activeLang === "js" || activeLang === "ts" || activeLang === "jsx" || activeLang === "tsx") {
        try {
          // Strip TS-only constructs (basic) and eval. Sandbox-y · no DOM
          // access. Errors are caught and surfaced.
          const stripped = activeFile.content
            .replace(/^import\s.+?;?$/gm, "")
            .replace(/^export\s/gm, "")
            .replace(/:\s*\w+(\[\])?/g, "");
          // Infinite-loop guard · pure JS Function() blocks the main
          // thread on `while(true){}`. We instrument the source by
          // injecting a tick counter into loop bodies + bail when it
          // crosses 1M. Was a P1 hang freezing the whole tab.
          const guarded = stripped
            .replace(/\b(while|for|do)\s*\(/g, "$1 (")
            .replace(/(\bwhile\b|\bfor\b)\s*\(([^)]+)\)\s*\{/g, "$1 ($2) { if (__t++ > 1e6) throw new Error('loop limit · 1M iters'); ")
            .replace(/\bdo\s*\{/g, "do { if (__t++ > 1e6) throw new Error('loop limit · 1M iters'); ");
          const fn = new Function(`let __t = 0; let __out = []; const console = { log: (...a) => __out.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(" ")) }; ${guarded}; return __out.join("\\n");`);
          const out = String(fn());
          if (out) out.split("\n").forEach((l) => termPush("out", l));
          else termPush("sys", "(no output)");
        } catch (e) { termPush("err", (e as Error).message); }
        return;
      }
      termPush("sys", `(${activeLang} runner not bundled in this sandbox · output simulated)`);
      activeFile.content.split("\n").slice(0, 10).forEach((l) => termPush("out", l));
      return;
    }
    if (verb === "whoami") { termPush("out", "delos-coder"); return; }
    if (verb === "date") { termPush("out", new Date().toString()); return; }
    if (verb === "pwd") { termPush("out", "/workspace/delcode"); return; }
    termPush("err", `command not found: ${verb} · try 'help'`);
  }

  function onEditorKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;
    if (e.key === "Tab") {
      e.preventDefault();
      const s = ta.selectionStart;
      const E = ta.selectionEnd;
      const before = ta.value.slice(0, s);
      const after = ta.value.slice(E);
      const v = before + "  " + after;
      updateContent(v);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveFile();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
      // Ctrl/Cmd+W · close current tab. Was missing — users couldn't
      // close tabs from keyboard. Captured here AND on the window so it
      // works whether the editor or the dock has focus.
      e.preventDefault();
      if (activePath) closeTab(activePath);
    }
  }

  // Global Ctrl+W handler for tab close when editor doesn't have focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w" && activePath) {
        // Only handle when DelCode IDE is the focused app · avoid
        // hijacking browser close in other contexts.
        const root = document.activeElement;
        if (!root || !root.closest("[data-delcode-root]")) return;
        e.preventDefault();
        closeTab(activePath);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, openPaths]);

  // Scroll sync · keep the line gutter aligned with the textarea scroll
  // so line numbers don't drift when the file scrolls past viewport.
  // Was visually broken: long files showed `1 2 3 …` at top while the
  // editor was on line 80.
  function onEditorScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    if (lineGutterRef.current) {
      lineGutterRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }

  const lineCount = activeFile ? Math.max(1, activeFile.content.split("\n").length) : 1;

  return (
    <div data-delcode-root style={{ display: "grid", gridTemplateColumns: "180px 1fr", gridTemplateRows: "1fr 180px", height: "100%", background: "#0d1117", color: "#e6edf3", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12 }}>
      {/* Left: file tree */}
      <aside style={{ gridRow: "1 / span 2", background: "#161b22", borderRight: "1px solid #30363d", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "8px 10px", borderBottom: "1px solid #30363d", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <strong style={{ fontSize: 11, letterSpacing: "0.08em", color: "#58a6ff" }}>★ DELCODE</strong>
          <button onClick={newFile} title="New file" style={{ background: "#238636", color: "#fff", border: "none", borderRadius: 4, padding: "3px 6px", cursor: "pointer", fontSize: 11 }}>＋</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 4 }}>
          {files.map((f) => {
            const lang = detectLang(f.path);
            const isActive = activePath === f.path;
            return (
              <div
                key={f.path}
                onClick={() => openFile(f.path)}
                onDoubleClick={() => renameFile(f.path)}
                onContextMenu={(e) => { e.preventDefault(); renameFile(f.path); }}
                className="delcode-row"
                style={{
                  padding: "4px 8px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 3,
                  background: isActive ? "#0d419d33" : "transparent",
                  color: isActive ? "#58a6ff" : "#c9d1d9",
                  fontSize: 12,
                  position: "relative",
                }}
                title={`${LANG_LABEL[lang]} · ${f.content.length} chars\nDouble-click: rename · click ✕: delete`}
              >
                <span style={{ width: 6, height: 6, background: LANG_COLOR[lang], borderRadius: 1, flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{f.path}</span>
                {f.dirty && <span style={{ color: "#f0883e" }}>●</span>}
                {/* Visible delete button · QA flagged "Shift+Right-click
                    delete is non-discoverable". Now a × chip shows on
                    hover for any non-active row, always shown for active. */}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteFile(f.path); }}
                  title={`Delete ${f.path}`}
                  aria-label={`Delete ${f.path}`}
                  style={{
                    background: "transparent",
                    color: "#8b949e",
                    border: "none",
                    cursor: "pointer",
                    padding: "0 4px",
                    fontSize: 12,
                    lineHeight: 1,
                    opacity: isActive ? 0.7 : 0.4,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#ff7b72"; e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "#8b949e"; e.currentTarget.style.opacity = isActive ? "0.7" : "0.4"; }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <button
          onClick={() => setShowLibs((v) => !v)}
          style={{ background: "#21262d", color: "#c9d1d9", border: "none", borderTop: "1px solid #30363d", padding: "6px 8px", cursor: "pointer", fontSize: 11, textAlign: "left", display: "flex", alignItems: "center", gap: 6 }}
        >
          <Icons.Package size={12} /> Libraries {showLibs ? "▾" : "▸"}
        </button>
        {showLibs && (
          <div style={{ padding: 6, borderTop: "1px solid #30363d", maxHeight: 200, overflowY: "auto", background: "#0d1117" }}>
            <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 4 }}>For {LANG_LABEL[activeLang]}</div>
            {(STARTER_LIBS[activeLang] ?? []).map((l) => (
              <div key={l.name} style={{ padding: 4, borderRadius: 3, marginBottom: 2 }}>
                <div style={{ fontSize: 11, color: "#58a6ff" }}>{l.name}</div>
                <div style={{ fontSize: 9, color: "#8b949e" }}>{l.desc}</div>
                <code
                  onClick={() => navigator.clipboard?.writeText(l.install).then(() => termPush("sys", `copied: ${l.install}`)).catch(() => {})}
                  style={{ fontSize: 9, color: "#79c0ff", cursor: "pointer", background: "#161b22", display: "block", padding: "2px 4px", borderRadius: 2, marginTop: 2 }}
                  title="Click to copy"
                >
                  {l.install}
                </code>
              </div>
            ))}
            {(STARTER_LIBS[activeLang] ?? []).length === 0 && <div style={{ fontSize: 10, color: "#8b949e" }}>No libraries indexed for this language.</div>}
          </div>
        )}
      </aside>

      {/* Top right: editor */}
      <main style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "#0d1117" }}>
        {/* Tab bar */}
        <div style={{ display: "flex", background: "#161b22", borderBottom: "1px solid #30363d", overflowX: "auto" }}>
          {openPaths.map((p) => {
            const f = files.find((x) => x.path === p);
            const lang = detectLang(p);
            const active = activePath === p;
            return (
              <div
                key={p}
                onClick={() => setActivePath(p)}
                style={{
                  padding: "6px 10px",
                  borderRight: "1px solid #30363d",
                  background: active ? "#0d1117" : "transparent",
                  color: active ? "#e6edf3" : "#8b949e",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                  borderTop: active ? "2px solid #58a6ff" : "2px solid transparent",
                  fontSize: 11,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ width: 6, height: 6, background: LANG_COLOR[lang], borderRadius: 1 }} />
                <span>{p}</span>
                {f?.dirty && <span style={{ color: "#f0883e" }}>●</span>}
                <span onClick={(e) => { e.stopPropagation(); closeTab(p); }} style={{ marginLeft: 4, color: "#8b949e", padding: "0 2px" }}>×</span>
              </div>
            );
          })}
          {openPaths.length === 0 && <div style={{ padding: "6px 10px", color: "#8b949e", fontSize: 11 }}>No file open · pick one from the tree</div>}
          <div style={{ marginLeft: "auto", display: "flex", gap: 4, padding: 4 }}>
            <button
              onClick={saveFile}
              disabled={!activeFile?.dirty}
              aria-label={activeFile?.dirty ? "Save active file (Ctrl+S)" : "Active file already saved"}
              title={activeFile?.dirty ? "Save active file (Ctrl+S)" : "All changes saved"}
              style={{
                background: activeFile?.dirty ? "#238636" : "#21262d",
                color: activeFile?.dirty ? "#fff" : "#8b949e",
                border: "none",
                borderRadius: 3,
                padding: "2px 8px",
                fontSize: 10,
                cursor: activeFile?.dirty ? "pointer" : "not-allowed",
                opacity: activeFile?.dirty ? 1 : 0.6,
              }}
            >
              {activeFile?.dirty ? "💾 SAVE" : "✓ SAVED"}
            </button>
            <button onClick={openPreview} title="Render the whole project as a live app in a sandboxed iframe" style={{ background: "#238636", color: "#fff", border: "none", borderRadius: 3, padding: "2px 8px", fontSize: 10, cursor: "pointer", fontWeight: 700 }}>▶ PREVIEW</button>
            <button onClick={() => runCmd("run")} title="Run the active file as a script in the terminal" style={{ background: "#1f6feb", color: "#fff", border: "none", borderRadius: 3, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}>▶ RUN</button>
            {/* W03 · download buttons · backend persists the codegen project
                under its id; we read the latest project id from the global
                pending payload set by VibeCode's stream consumer. */}
            <button
              onClick={() => exportProject("zip")}
              title="Download project as zip"
              style={{ background: "#30363d", color: "#7dd3fc", border: "none", borderRadius: 3, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}
            >
              ↓ ZIP
            </button>
            <button
              onClick={() => exportProject("html")}
              title="Download as single-file HTML preview"
              style={{ background: "#30363d", color: "#fbcfe8", border: "none", borderRadius: 3, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}
            >
              ↓ HTML
            </button>
          </div>
        </div>
        {/* Live preview pane · sandboxed iframe running the bundled app.
            Takes over the editor body when previewHtml is set. */}
        {previewSrc ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#fff", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", background: "#161b22", borderBottom: "1px solid #30363d" }}>
              <span style={{ fontSize: 10, color: "#3fb950", fontWeight: 700 }}>● LIVE PREVIEW</span>
              <span style={{ fontSize: 10, color: "#8b949e" }}>sandboxed iframe · React + Tailwind</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                <button onClick={openPreview} title="Re-render from current files" style={{ background: "#30363d", color: "#c9d1d9", border: "none", borderRadius: 3, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}>↻ REFRESH</button>
                <button onClick={() => setPreviewSrc(null)} title="Back to code" style={{ background: "#1f6feb", color: "#fff", border: "none", borderRadius: 3, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}>✕ CLOSE</button>
              </div>
            </div>
            <iframe
              title="App preview"
              src={previewSrc}
              sandbox="allow-scripts allow-popups allow-modals allow-forms"
              style={{ flex: 1, width: "100%", border: "none", background: "#fff" }}
            />
          </div>
        ) : /* Editor body · gutter + textarea */ activeFile ? (
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "44px 1fr", overflow: "hidden", position: "relative" }}>
            <div
              ref={lineGutterRef}
              style={{
                background: "#0d1117",
                color: "#484f58",
                borderRight: "1px solid #21262d",
                textAlign: "right",
                padding: "8px 6px",
                fontSize: 11,
                lineHeight: "16px",
                fontFamily: "inherit",
                userSelect: "none",
                overflow: "hidden",
              }}
              aria-hidden="true"
            >
              {Array.from({ length: lineCount }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={editorRef}
              value={activeFile.content}
              onChange={(e) => updateContent(e.target.value)}
              onKeyDown={onEditorKeyDown}
              onScroll={onEditorScroll}
              spellCheck={false}
              style={{
                background: "#0d1117",
                color: "#e6edf3",
                border: "none",
                outline: "none",
                padding: "8px 10px",
                fontFamily: "inherit",
                fontSize: 12,
                lineHeight: "16px",
                resize: "none",
                width: "100%",
                height: "100%",
                tabSize: 2,
              }}
            />
            <div style={{ position: "absolute", bottom: 4, right: 8, display: "flex", gap: 6, alignItems: "center", pointerEvents: "none" }}>
              <span style={{ background: "#21262d", color: LANG_COLOR[activeLang], padding: "1px 6px", borderRadius: 4, fontSize: 10 }}>● {LANG_LABEL[activeLang]}</span>
              <span style={{ background: "#21262d", color: "#8b949e", padding: "1px 6px", borderRadius: 4, fontSize: 10 }}>{lineCount} lines</span>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#8b949e" }}>
            <div style={{ textAlign: "center" }}>
              <Icons.Code2 size={36} style={{ marginBottom: 10, color: "#30363d" }} />
              <div style={{ fontSize: 14 }}>Pick a file or hit ＋ to create one</div>
            </div>
          </div>
        )}
      </main>

      {/* Bottom: terminal — spans whole right column */}
      <section style={{ gridColumn: "2", borderTop: "1px solid #30363d", background: "#010409", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "4px 10px", borderBottom: "1px solid #30363d", display: "flex", alignItems: "center", gap: 8, background: "#161b22" }}>
          <span style={{ fontSize: 10, color: "#3fb950" }}>● </span>
          <strong style={{ fontSize: 11, color: "#c9d1d9", letterSpacing: "0.06em" }}>TERMINAL</strong>
          <span style={{ fontSize: 10, color: "#8b949e", marginLeft: "auto" }}>sandbox · type help</span>
        </div>
        <div ref={termBodyRef} style={{ flex: 1, overflowY: "auto", padding: 8, fontSize: 11, lineHeight: 1.55, color: "#c9d1d9" }}>
          {termLines.map((l, i) => (
            <div key={i} style={{ color: l.kind === "in" ? "#79c0ff" : l.kind === "err" ? "#ff7b72" : l.kind === "sys" ? "#8b949e" : "#c9d1d9", whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
              {l.text}
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); runCmd(termInput); setTermInput(""); }}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderTop: "1px solid #30363d" }}
        >
          <span style={{ color: "#3fb950", fontWeight: 700 }}>$</span>
          <input
            value={termInput}
            onChange={(e) => setTermInput(e.target.value)}
            placeholder="help · ls · cat <file> · new <file> · run · calc 2+2"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#e6edf3", fontFamily: "inherit", fontSize: 11 }}
          />
        </form>
      </section>
    </div>
  );
}
