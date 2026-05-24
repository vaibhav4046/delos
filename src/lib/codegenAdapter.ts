// Adapter: convert /api/codegen-app project tree → Sandpack-runnable React app.
//
// Codegen emits Next.js App-Router-shaped paths (app/page.tsx, app/components/*,
// app/api/*, …). Sandpack's react-ts template expects a Vite-shaped tree with
// /App.tsx as the entry and no framework magic. This adapter:
//
//  1. Picks the entry file (app/page.tsx, else first .tsx)
//  2. Re-roots paths: app/components/Hero.tsx → /components/Hero.tsx
//  3. Strips Next-only imports: next/link → stub, next/image → stub,
//     next/navigation/font/server → stubs so the code compiles. The stubs
//     ship as virtual files under /__next/*.
//  4. Drops server-only files (route.ts, page.server, /api/*) — Sandpack
//     is client-only.
//  5. Adds a minimal Tailwind-Play <style> so utility classes still paint.
//
// Output: { files: Record<path, { code }>, entry, error? }
// The CodebaseApp pipes that straight into <Sandpack>.

type InFile = { path: string; content: string; language?: string };

export type SandpackFiles = Record<string, { code: string; hidden?: boolean }>;

export type AdapterResult = {
  files: SandpackFiles;
  entry: string;
  dependencies: Record<string, string>;
  warnings: string[];
};

const NEXT_LINK_STUB = `// Stub for next/link — preview only.
import * as React from "react";
type AnyAnchor = React.AnchorHTMLAttributes<HTMLAnchorElement>;
export default function Link({ href, children, ...rest }: AnyAnchor) {
  return <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>;
}
`;

const NEXT_IMAGE_STUB = `// Stub for next/image — preview only.
import * as React from "react";
type Props = React.ImgHTMLAttributes<HTMLImageElement> & { src: string; alt?: string; width?: number; height?: number };
export default function Image({ src, alt, width, height, ...rest }: Props) {
  return <img src={src} alt={alt ?? ""} width={width} height={height} {...rest} />;
}
`;

const NEXT_NAV_STUB = `// Stub for next/navigation — preview only.
export function useRouter() { return { push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }; }
export function usePathname() { return "/"; }
export function useSearchParams() { return new URLSearchParams(); }
export function redirect(_url: string) { return null; }
`;

const NEXT_FONT_STUB = `// Stub for next/font — preview only.
export function Inter() { return { className: "", style: { fontFamily: "system-ui" } }; }
export function JetBrains_Mono() { return { className: "", style: { fontFamily: "ui-monospace, monospace" } }; }
`;

const NEXT_HEADERS_STUB = `// Stub for next/headers — preview only (no-ops).
export function cookies() { return { get: () => null, set: () => {}, getAll: () => [] }; }
export function headers() { return new Headers(); }
`;

// Pages-router Head component — codegen sometimes mixes paradigms.
const NEXT_HEAD_STUB = `// Stub for next/head — preview only.
import * as React from "react";
export default function Head({ children }: { children?: React.ReactNode }) { return null; }
`;

// next/script + next/dynamic + next/document — catch-all stubs.
const NEXT_SCRIPT_STUB = `// Stub for next/script — preview only.
import * as React from "react";
export default function Script(_props: React.ScriptHTMLAttributes<HTMLScriptElement>) { return null; }
`;
const NEXT_DYNAMIC_STUB = `// Stub for next/dynamic — preview only.
export default function dynamic<T>(loader: () => Promise<{ default: T }>): T {
  // Synchronous return is wrong technically but lets the import resolve at module
  // eval time. Real apps would lazy-load; in the preview we want eager render.
  return loader as unknown as T;
}
`;
const NEXT_DOCUMENT_STUB = `// Stub for next/document — preview only.
import * as React from "react";
export function Html({ children, ...p }: React.HTMLAttributes<HTMLHtmlElement> & { children?: React.ReactNode }) { return <div {...p}>{children}</div>; }
export function Head({ children }: { children?: React.ReactNode }) { return null; }
export function Main() { return null; }
export function NextScript() { return null; }
export default function Document() { return null; }
`;
const NEXT_ROOT_STUB = `// Stub for "next" root types — preview only.
import * as React from "react";
export type NextPage<P = {}, IP = P> = React.FC<P>;
export type GetServerSideProps = (...args: unknown[]) => Promise<{ props: unknown }>;
export type GetStaticProps = (...args: unknown[]) => Promise<{ props: unknown }>;
`;

/** Strip leading `app/` from any path; map common Next paths to Vite-shape. */
function reroot(p: string): string {
  let out = p.replace(/^\.?\//, "");
  if (out.startsWith("app/")) out = out.slice(4);
  if (out.startsWith("src/")) out = out.slice(4);
  return "/" + out;
}

/** Should this file participate in the client preview? */
function isClientRunnable(path: string): boolean {
  const p = path.toLowerCase();
  if (p.includes("/api/")) return false;
  if (p.endsWith("route.ts") || p.endsWith("route.tsx")) return false;
  if (p.includes("middleware.ts")) return false;
  if (p.endsWith(".server.ts") || p.endsWith(".server.tsx")) return false;
  if (p.endsWith(".md") || p.endsWith(".mdx")) return false;
  if (p.endsWith(".json")) return false;
  return true;
}

/** Rewrite next/* imports to local stub paths.
 *  Catch-all at the end ensures even unknown subpaths (next/something-new)
 *  resolve to a no-op module so the bundler doesn't 500. */
function rewriteNextImports(code: string): string {
  return code
    .replace(/from\s+["']next\/link["']/g, 'from "/__next/link"')
    .replace(/from\s+["']next\/image["']/g, 'from "/__next/image"')
    .replace(/from\s+["']next\/navigation["']/g, 'from "/__next/navigation"')
    .replace(/from\s+["']next\/font\/google["']/g, 'from "/__next/font"')
    .replace(/from\s+["']next\/font\/local["']/g, 'from "/__next/font"')
    .replace(/from\s+["']next\/headers["']/g, 'from "/__next/headers"')
    .replace(/from\s+["']next\/server["']/g, 'from "/__next/headers"')
    .replace(/from\s+["']next\/head["']/g, 'from "/__next/head"')
    .replace(/from\s+["']next\/script["']/g, 'from "/__next/script"')
    .replace(/from\s+["']next\/dynamic["']/g, 'from "/__next/dynamic"')
    .replace(/from\s+["']next\/document["']/g, 'from "/__next/document"')
    // Catch-all for next/<anything-else> — point at root stub.
    .replace(/from\s+["']next\/[^"']+["']/g, 'from "/__next/root"')
    // Bare `from "next"` — root types import.
    .replace(/from\s+["']next["']/g, 'from "/__next/root"')
    // Strip "use client" / "use server" directives — meaningless in Vite.
    .replace(/^\s*["']use (client|server)["'];?\s*\n/m, "");
}

/** Resolve relative imports against the file's new rooted path. Sandpack uses
 *  absolute-from-root paths, so a sibling import like "./Hero" in /App.tsx
 *  resolves to "/Hero". */
function rewriteRelativeImports(code: string, fileAbsPath: string): string {
  return code.replace(
    /from\s+["'](\.\.?\/[^"']+)["']/g,
    (_match, rel) => `from "${resolveRel(fileAbsPath, rel)}"`,
  );
}
function resolveRel(fromPath: string, rel: string): string {
  const fromDir = fromPath.substring(0, fromPath.lastIndexOf("/")) || "/";
  const parts = (fromDir + "/" + rel).split("/").filter((p) => p && p !== ".");
  const stack: string[] = [];
  for (const p of parts) {
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  return "/" + stack.join("/");
}

/** Inject a single tailwind-play <style> via Tailwind Play CDN script in
 *  index.html so utility classes paint. Sandpack's react-ts template doesn't
 *  ship Tailwind by default. */
const PREVIEW_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DelOS Codebase Preview</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; background: #0b0b14; color: #f4f1de; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/index.tsx"></script>
  </body>
</html>
`;

const PREVIEW_INDEX_TSX = `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
const el = document.getElementById("root");
if (el) createRoot(el).render(<React.StrictMode><App /></React.StrictMode>);
`;

export function adaptForSandpack(projectFiles: InFile[]): AdapterResult {
  const warnings: string[] = [];
  const out: SandpackFiles = {};

  // Always-on virtuals
  out["/index.html"] = { code: PREVIEW_INDEX_HTML, hidden: true };
  out["/index.tsx"] = { code: PREVIEW_INDEX_TSX, hidden: true };
  out["/__next/link.tsx"] = { code: NEXT_LINK_STUB, hidden: true };
  out["/__next/image.tsx"] = { code: NEXT_IMAGE_STUB, hidden: true };
  out["/__next/navigation.ts"] = { code: NEXT_NAV_STUB, hidden: true };
  out["/__next/font.ts"] = { code: NEXT_FONT_STUB, hidden: true };
  out["/__next/headers.ts"] = { code: NEXT_HEADERS_STUB, hidden: true };
  out["/__next/head.tsx"] = { code: NEXT_HEAD_STUB, hidden: true };
  out["/__next/script.tsx"] = { code: NEXT_SCRIPT_STUB, hidden: true };
  out["/__next/dynamic.ts"] = { code: NEXT_DYNAMIC_STUB, hidden: true };
  out["/__next/document.tsx"] = { code: NEXT_DOCUMENT_STUB, hidden: true };
  out["/__next/root.tsx"] = { code: NEXT_ROOT_STUB, hidden: true };

  // First pass: re-root paths + filter server-only files.
  const rerooted: Array<{ origPath: string; absPath: string; content: string }> = [];
  for (const f of projectFiles) {
    if (!isClientRunnable(f.path)) {
      warnings.push(`skipped server-only: ${f.path}`);
      continue;
    }
    let abs = reroot(f.path);
    // Map app/page.tsx → /App.tsx so Sandpack's react-ts template entry resolves.
    if (abs === "/page.tsx" || abs === "/page.jsx") abs = "/App.tsx";
    rerooted.push({ origPath: f.path, absPath: abs, content: f.content });
  }

  // Second pass: rewrite imports.
  for (const r of rerooted) {
    const next1 = rewriteNextImports(r.content);
    const next2 = rewriteRelativeImports(next1, r.absPath);
    out[r.absPath] = { code: next2 };
  }

  // If no App.tsx was produced (e.g. project didn't have page.tsx), synthesize
  // one that imports + renders the first component we have.
  if (!out["/App.tsx"]) {
    const firstComponent = rerooted.find((r) => /\.tsx$/.test(r.absPath));
    if (firstComponent) {
      const compName = firstComponent.absPath.split("/").pop()!.replace(/\.tsx$/, "");
      const importPath = firstComponent.absPath.replace(/\.tsx$/, "");
      out["/App.tsx"] = {
        code: `import ${compName} from "${importPath}";\nexport default function App(){return <${compName}/>;}\n`,
      };
      warnings.push(`synthesized /App.tsx wrapping ${firstComponent.absPath}`);
    } else {
      out["/App.tsx"] = {
        code: `export default function App(){return <div style={{padding:24,color:"#fff"}}>No client-runnable entry point in this project. Open the FILES tab to read the code.</div>;}\n`,
      };
      warnings.push("no client-runnable entry — placeholder App.tsx mounted");
    }
  }

  return {
    files: out,
    entry: "/index.tsx",
    // Common deps the model tends to import. Sandpack will tree-shake unused.
    dependencies: {
      react: "^18.2.0",
      "react-dom": "^18.2.0",
    },
    warnings,
  };
}
