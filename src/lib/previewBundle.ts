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

function stripImports(src: string): string {
  let s = src;
  // Multiline + single-line ES imports: `import ... from '...'`, side-effect
  // `import '...'`, and `import type ...`. The `[^;]*?` with the `from`/quote
  // anchors keeps it from eating past the statement.
  s = s.replace(/^\s*import\s+type\s+[^;\n]*?;?\s*$/gm, "");
  s = s.replace(/^\s*import\s+[\s\S]*?from\s*["'][^"']*["']\s*;?\s*$/gm, "");
  s = s.replace(/^\s*import\s*["'][^"']*["']\s*;?\s*$/gm, "");
  // `export ... from '...'` re-exports — drop.
  s = s.replace(/^\s*export\s+[\s\S]*?from\s*["'][^"']*["']\s*;?\s*$/gm, "");
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
  // Named exports: drop the keyword, keep the declaration.
  s = s.replace(/^\s*export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, "");
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
    const noImports = stripImports(f.content);
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

  const mergedSource = escapeForScript(transformed.join("\n\n"));

  // React hook + Next shims so stripped imports don't leave undefined refs.
  const preamble = `
const { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useReducer, useContext, createContext, useId, useTransition, useDeferredValue, forwardRef, memo, Fragment, Children, cloneElement, isValidElement, Suspense, createElement } = React;
// Minimal next/* shims for previewing Next-flavored output.
const Image = (props) => { const { src, alt, width, height, fill, priority, ...rest } = props || {}; return React.createElement('img', { src: typeof src === 'object' && src ? src.src : src, alt: alt || '', width, height, ...rest }); };
const Link = ({ href, children, ...rest }) => React.createElement('a', { href: typeof href === 'object' ? '#' : href, ...rest }, children);
const useRouter = () => ({ push(){}, replace(){}, back(){}, forward(){}, refresh(){}, prefetch(){} });
const usePathname = () => '/';
const useSearchParams = () => new URLSearchParams();
const dynamic = (loader) => (props) => React.createElement('div', null, '');
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
<script type="text/babel" data-presets="react,typescript">
${runner}
</script>
</body>
</html>`;
}
