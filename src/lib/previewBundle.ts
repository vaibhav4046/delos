// Isomorphic project → single-file runnable HTML bundler.
//
// DelOS codegen emits a multi-file React/Next project (app/page.tsx +
// app/components/*.tsx + data/lib + globals.css). There was no way to actually
// SEE that app run — DelCode only showed source + a fake terminal, and the
// HTML export wrapped each file in its own <script> which broke the moment a
// file used an ES `import` (separate Babel scripts can't resolve local modules).
//
// This bundler flattens the whole project into ONE Babel-standalone script so
// every component/const lands in a single shared scope and cross-file
// references resolve as globals. React + ReactDOM come from UMD, Tailwind from
// the Play CDN. The result runs in a sandboxed <iframe srcDoc> (inline preview)
// AND as the downloadable .html export — single source of truth.
//
// It is intentionally a best-effort transpile-and-run, not a real bundler:
// good enough to preview the generated single-page apps DelOS produces, with a
// visible in-#root error if something slips through (never a blank pane).

export type PreviewFile = { path: string; content: string };

// Next.js route-segment config / metadata exports that are useless in a
// client preview and frequently collide across files (layout.tsx AND page.tsx
// both `export const metadata`). Rename each to a unique inert binding so the
// merged scope doesn't throw "Identifier already declared".
const NEXT_CONFIG_IDENTS = [
  "metadata",
  "viewport",
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "generateMetadata",
  "generateStaticParams",
  "generateViewport",
];

// Turn one import clause + module into shim `const` bindings so a stripped
// third-party import (framer-motion, lucide-react, clsx, recharts, next/*, …)
// doesn't leave undefined identifiers that crash the render. `__shim` /
// `__shimNS` are defined in the runtime preamble.
function shimClause(clause: string, mod: string): string {
  const m = JSON.stringify(mod);
  const decls: string[] = [];
  // `var` (not const) so the same symbol imported in multiple files doesn't
  // throw "Identifier already declared" in the merged single-scope bundle.
  const ns = clause.match(/\*\s+as\s+([A-Za-z0-9_$]+)/);
  if (ns) decls.push(`var ${ns[1]} = __shimNS(${m});`);
  const named = clause.match(/\{([^}]*)\}/);
  if (named) {
    for (const part of named[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      const asM = part.match(/^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/);
      if (asM) decls.push(`var ${asM[2]} = __shim(${m}, ${JSON.stringify(asM[1])});`);
      else if (/^[A-Za-z0-9_$]+$/.test(part)) decls.push(`var ${part} = __shim(${m}, ${JSON.stringify(part)});`);
    }
  }
  const def = clause.match(/^\s*([A-Za-z0-9_$]+)\s*(?:,|$)/);
  if (def && def[1] !== "type") decls.push(`var ${def[1]} = __shim(${m}, "default");`);
  return decls.join(" ");
}

// Rewrite a file's import statements: local + react/react-dom imports are
// dropped (the flattened shared scope + UMD globals + hook preamble cover
// them); every other module is converted to shim bindings so the preview never
// blanks on an undefined third-party symbol.
function rewriteImports(src: string): string {
  let s = src;
  s = s.replace(/^\s*import\s+type\s+[^;\n]*?;?\s*$/gm, "");
  s = s.replace(/^\s*import\s*["'][^"']*["']\s*;?\s*$/gm, ""); // side-effect (css etc)
  s = s.replace(/^\s*export\s+[\s\S]*?from\s*["'][^"']*["']\s*;?\s*$/gm, "");
  s = s.replace(/^\s*import\s+([\s\S]*?)\s+from\s*["']([^"']+)["']\s*;?\s*$/gm, (_m, clause: string, mod: string) => {
    // Local modules (relative OR the `@/` / `~/` path aliases) are dropped — the
    // real declarations live in the flattened shared scope. Only `@/…` (alias),
    // NOT `@scope/pkg` (npm), counts as local. Shimming an alias import would
    // re-declare a symbol that already exists → "already declared" → blank.
    if (/^[./]/.test(mod) || /^[@~]\//.test(mod) || mod === "react" || mod === "react-dom" || mod === "react-dom/client") return "";
    return shimClause(clause.trim(), mod);
  });
  return s;
}

function stripExports(src: string, fileIdx: number): { code: string; defaultName: string | null } {
  let s = src;
  let defaultName: string | null = null;

  // Rename Next route-config exports to unique inert names BEFORE the generic
  // export-strip, so collisions across files can't crash the shared scope.
  for (const id of NEXT_CONFIG_IDENTS) {
    const re = new RegExp(`export\\s+(?:async\\s+)?(const|let|var|function)\\s+${id}\\b`, "g");
    s = s.replace(re, (_m, kw) => `${kw} __nx_${id}_${fileIdx}`);
  }

  // `export default function Name(` → capture Name, drop `export default `.
  s = s.replace(/export\s+default\s+function\s+([A-Za-z0-9_$]+)/, (_m, name) => {
    defaultName = name;
    return `function ${name}`;
  });
  // `export default class Name`
  s = s.replace(/export\s+default\s+class\s+([A-Za-z0-9_$]+)/, (_m, name) => {
    defaultName = name;
    return `class ${name}`;
  });
  // Anonymous `export default function(` → name it after the file.
  if (!defaultName) {
    s = s.replace(/export\s+default\s+function\s*\(/, () => {
      defaultName = `__Default_${fileIdx}`;
      return `function __Default_${fileIdx}(`;
    });
  }
  // Anonymous `export default () => ...` or `export default <expr>;`
  if (!defaultName) {
    s = s.replace(/export\s+default\s+/, () => {
      defaultName = `__Default_${fileIdx}`;
      return `const __Default_${fileIdx} = `;
    });
  }
  // `export type { ... }` type-only re-exports — drop.
  s = s.replace(/^\s*export\s+type\s*\{[^}]*\}\s*;?\s*$/gm, "");
  // Named exports — drop the `export` keyword, keep the declaration. Includes
  // the TS-only forms (interface / type / enum / namespace / abstract class /
  // declare): their leftover `export` is a hard SyntaxError in the classic
  // script scope we run in (it blanks the WHOLE preview), and Babel's
  // typescript preset then strips the type declarations themselves.
  s = s.replace(
    /^(\s*)export\s+(?=(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:interface|type|enum|namespace|class|function|const|let|var)\b)/gm,
    "$1",
  );
  // `export { ... }` statement lines — drop.
  s = s.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, "");

  return { code: s, defaultName };
}

function isSourceFile(path: string): boolean {
  if (!/\.(t|j)sx?$/.test(path)) return false;
  // Skip config files that aren't app code.
  if (/(?:^|\/)(next\.config|tailwind\.config|postcss\.config|\.eslintrc|vite\.config)\.[tj]s$/.test(path)) return false;
  return true;
}

function entryRank(path: string): number {
  const p = path.toLowerCase();
  if (/(^|\/)app\/page\.[tj]sx?$/.test(p)) return 0;
  if (/(^|\/)page\.[tj]sx?$/.test(p)) return 1;
  if (/(^|\/)src\/app\/page\.[tj]sx?$/.test(p)) return 0;
  if (/(^|\/)app\.[tj]sx?$/.test(p)) return 2;
  if (/(^|\/)index\.[tj]sx?$/.test(p)) return 3;
  return 99;
}

// Order so leaf modules (data/lib/components) are defined before the page that
// consumes them — avoids const temporal-dead-zone on module-top-level refs.
function orderRank(path: string): number {
  const p = path.toLowerCase();
  if (/\/(data|lib|utils|hooks|types|constants|config)\//.test(p)) return 0;
  if (/\/components?\//.test(p)) return 1;
  if (/layout\.[tj]sx?$/.test(p)) return 2;
  if (entryRank(p) < 99) return 3; // entry page last
  return 1;
}

function escapeForScript(s: string): string {
  // Prevent a literal </script> inside source from closing our script tag.
  return s.replace(/<\/script>/gi, "<\\/script>");
}

export function htmlEscape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

// Rename duplicate top-level declarations across the flattened bundle. Real
// multi-file output often has several `export default function Page` (one per
// route) or repeated helpers; after export-stripping they become duplicate
// `function Page` / `const X` in one scope → a SyntaxError that blanks the whole
// preview. Keep the first of each name (cross-file refs resolve to it) and
// rename later declarations so they don't collide. `var` is skipped — JS allows
// var redeclaration, so the import shims never throw.
function dedupeTopLevel(src: string): string {
  const seen = new Set<string>();
  const n: Record<string, number> = {};
  return src.replace(
    /^(export\s+)?(default\s+)?(async\s+)?(function|class|const|let)\s+([A-Za-z0-9_$]+)/gm,
    (m, exp, def, asy, kw, name) => {
      if (!seen.has(name)) { seen.add(name); return m; }
      n[name] = (n[name] ?? 1) + 1;
      return `${exp ?? ""}${def ?? ""}${asy ?? ""}${kw} ${name}__d${n[name]}`;
    },
  );
}

/**
 * Bundle a codegen project into one self-contained, runnable HTML document.
 * Renders the detected entry component (app/page default export) into #root.
 */
export function bundleProjectToHtml(files: PreviewFile[], name = "DelOS app"): string {
  const cssBlocks = files
    .filter((f) => f.path.endsWith(".css"))
    .map((f) => f.content)
    // Tailwind directives are handled by the Play CDN; strip the bare
    // @tailwind lines so they don't show as raw text / CSS errors.
    .map((c) => c.replace(/^\s*@tailwind\s+[^;]+;?\s*$/gim, ""))
    .join("\n\n");

  const sources = files
    .filter((f) => isSourceFile(f.path))
    .sort((a, b) => orderRank(a.path) - orderRank(b.path));

  // Pick the entry: default export of the highest-ranked entry file.
  const entryFiles = [...sources].sort((a, b) => entryRank(a.path) - entryRank(b.path));
  let entryName: string | null = null;

  const transformed: string[] = [];
  sources.forEach((f, i) => {
    const noImports = rewriteImports(f.content);
    const { code, defaultName } = stripExports(noImports, i);
    // Drop "use client" / "use server" directives.
    const clean = code.replace(/^\s*["']use (client|server)["']\s*;?\s*$/gm, "");
    if (entryName === null && entryFiles[0] && f.path === entryFiles[0].path && defaultName) {
      entryName = defaultName;
    }
    transformed.push(`/* ── ${f.path} ── */\n${clean}`);
  });

  // Secondary entry detection: a top-level function named like a page.
  const entryGuess = entryName
    ? `(typeof ${entryName} !== 'undefined' && ${entryName})`
    : "false";

  const mergedSource = escapeForScript(dedupeTopLevel(transformed.join("\n\n")));

  // React hook + Next shims so stripped imports don't leave undefined refs.
  const preamble = `
const { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useReducer, useContext, createContext, useId, useTransition, useDeferredValue, forwardRef, memo, Fragment, Children, cloneElement, isValidElement, Suspense, createElement } = React;
// Minimal next/* shims. Declared with var (not const) so a generated file that
// imports e.g. useRouter from next/navigation (rebound to var useRouter via the
// shim) does not collide — a const here would SyntaxError and blank the preview.
var Image = (props) => { const { src, alt, width, height, fill, priority, ...rest } = props || {}; return React.createElement('img', { src: typeof src === 'object' && src ? src.src : src, alt: alt || '', width, height, ...rest }); };
var Link = ({ href, children, ...rest }) => React.createElement('a', { href: typeof href === 'object' ? '#' : href, ...rest }, children);
var useRouter = () => ({ push(){}, replace(){}, back(){}, forward(){}, refresh(){}, prefetch(){} });
var usePathname = () => '/';
var useSearchParams = () => new URLSearchParams();
var dynamic = (loader) => (props) => React.createElement('div', null, '');
// ── Universal third-party import shims ───────────────────────────────────
// Generated apps routinely import framer-motion, lucide-react, clsx, recharts,
// next/*, toast libs, etc. Those imports are stripped + rebound to these shims
// so an undefined symbol never blanks the whole preview.
const __MOTION_PROPS = { animate:1, initial:1, exit:1, transition:1, variants:1, whileHover:1, whileTap:1, whileFocus:1, whileInView:1, whileDrag:1, layout:1, layoutId:1, drag:1, dragConstraints:1, dragElastic:1, dragMomentum:1, custom:1, viewport:1, transformTemplate:1, onAnimationComplete:1, onAnimationStart:1, onViewportEnter:1, onViewportLeave:1 };
function __cleanProps(p){ if(!p||typeof p!=='object') return p; var o={}; for(var k in p){ if(!__MOTION_PROPS[k]) o[k]=p[k]; } return o; }
const __passthrough = (props) => React.createElement('div', __cleanProps(props), props && props.children);
const __motion = new Proxy({}, { get: (_t, tag) => (props) => React.createElement(typeof tag==='string'?tag:'div', __cleanProps(props), props && props.children) });
const __icon = (props) => { var s=(props&&props.size)||16; return React.createElement('span', { className:(props&&props.className)||'', 'aria-hidden':'true', style:{ display:'inline-block', width:s, height:s, verticalAlign:'middle' } }); };
function __cx(){ var out=[]; for(var i=0;i<arguments.length;i++){ var a=arguments[i]; if(!a) continue; if(typeof a==='string'||typeof a==='number') out.push(String(a)); else if(Array.isArray(a)) out.push(__cx.apply(null,a)); else if(typeof a==='object'){ for(var k in a){ if(a[k]) out.push(k); } } } return out.join(' '); }
// Infinitely call-/access-safe: __noop() and __noop.x.y() never throw
// "is not a function" — they keep returning __noop. Covers unknown shimmed
// utilities used in chains (e.g. storage().get().whatever).
const __noop = new Proxy(function(){ return __noop; }, { get: () => __noop, apply: () => __noop });
function __shim(mod, name){
  if(mod==='framer-motion'){ if(name==='AnimatePresence') return (p) => React.createElement(React.Fragment, null, p && p.children); if(name==='motion'||name==='m') return __motion; if(name==='useAnimation'||name==='useAnimationControls') return () => ({ start:()=>Promise.resolve(), stop(){}, set(){} }); if(name==='useInView') return () => true; if(name==='useScroll') return () => ({ scrollYProgress:{ on(){}, get:()=>0 } }); if(name==='useTransform'||name==='useMotionValue'||name==='useSpring'||name==='useMotionValueEvent') return (v) => v; return __passthrough; }
  if(mod==='lucide-react' || mod.indexOf('react-icons')>=0 || mod.indexOf('heroicons')>=0 || mod.indexOf('react-feather')>=0 || mod.indexOf('@radix-ui/react-icons')>=0) return __icon;
  if(mod==='clsx'||mod==='classnames'||mod==='tailwind-merge'||name==='clsx'||name==='cn'||name==='cx'||name==='twMerge'||name==='classNames') return __cx;
  if(mod==='recharts'||mod.indexOf('chart')>=0) return __passthrough;
  if(mod.indexOf('next/')===0){ if(mod==='next/image') return Image; if(mod==='next/link') return Link; if(mod==='next/dynamic') return () => __passthrough; if(name==='useRouter') return useRouter; if(name==='usePathname') return usePathname; if(name==='useSearchParams') return useSearchParams; if(name==='useParams') return () => ({}); if(name==='useSelectedLayoutSegment'||name==='useSelectedLayoutSegments') return () => null; if(name==='redirect'||name==='notFound'||name==='permanentRedirect') return () => {}; if(name==='default') return __passthrough; return __noop; }
  if(mod==='react-hot-toast'||mod==='sonner'){ if(name==='Toaster') return __passthrough; var t=function(){return '';}; t.success=function(){};t.error=function(){};t.loading=function(){};t.dismiss=function(){};t.custom=function(){}; return t; }
  if(name==='default') return __passthrough;
  if(/^[A-Z]/.test(name)) return __passthrough;
  return __noop;
}
function __shimNS(mod){ return new Proxy({}, { get: (_t, name) => __shim(mod, String(name)) }); }
`.trim();

  const runner = `
${preamble}

${mergedSource}

(function () {
  function Fallback() {
    return React.createElement('div', { style: { padding: 24, fontFamily: 'ui-sans-serif,system-ui', color: '#a1a1aa' } },
      React.createElement('div', { style: { fontWeight: 700, marginBottom: 8, color: '#e5e5e5' } }, ${JSON.stringify(name)}),
      'Preview mounted, but no page entry component was detected.');
  }
  var Entry = ${entryGuess} ||
    (typeof Page !== 'undefined' && Page) ||
    (typeof App !== 'undefined' && App) ||
    (typeof Home !== 'undefined' && Home) ||
    (typeof Dashboard !== 'undefined' && Dashboard) ||
    (typeof Main !== 'undefined' && Main) ||
    Fallback;
  try {
    var rootEl = document.getElementById('root');
    ReactDOM.createRoot(rootEl).render(React.createElement(Entry));
  } catch (e) {
    document.getElementById('root').innerHTML =
      '<pre style="padding:20px;color:#fda4af;white-space:pre-wrap;font:12px ui-monospace,monospace">Preview error:\\n' +
      String((e && e.stack) || e).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }) +
      '</pre>';
  }
})();
`.trim();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${htmlEscape(name)} — DelOS preview</title>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
<style>
html,body{margin:0;background:#0a0a0a;color:#e5e5e5;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;}
#root{min-height:100vh;}
${cssBlocks}
</style>
</head>
<body>
<div id="root"></div>
<script id="__delsrc" type="text/plain">
${runner}
</script>
<script>
// Manual transform (not the auto text/babel handler) so we can force TSX mode —
// otherwise Babel parses TS generics like \`useState<Foo>()\` /
// \`(e: KeyboardEvent<HTMLInputElement>)\` as JSX and throws. Compile + runtime
// errors are shown in #root instead of silently blanking the preview.
(function () {
  function showErr(label, e) {
    var pre = document.createElement('pre');
    pre.style.cssText = 'padding:20px;color:#fda4af;white-space:pre-wrap;font:12px ui-monospace,monospace';
    pre.textContent = label + '\\n' + String((e && e.stack) || e);
    var r = document.getElementById('root'); if (r) { r.innerHTML = ''; r.appendChild(pre); }
  }
  try {
    var src = document.getElementById('__delsrc').textContent;
    var out = Babel.transform(src, {
      filename: 'app.tsx',
      presets: [['typescript', { isTSX: true, allExtensions: true }], ['react', { runtime: 'classic' }]],
    }).code;
    try { (0, eval)(out); } catch (e) { showErr('Preview runtime error:', e); }
  } catch (e) { showErr('Preview build error:', e); }
})();
</script>
</body>
</html>`;
}
