// SSRF guard for any user-supplied URL we later fetch server-side.
// Blocks loopback / private / link-local / cloud-metadata / non-HTTP schemes,
// re-checks the Location header on manual-redirect responses, AND (server-side
// only) resolves the hostname via DNS to validate the *actual* destination IPs
// — so a public name whose A/AAAA record points at 169.254.169.254 or 10.x
// can't slip through (DNS-rebind / DNS-pinned SSRF).
//
// `node:dns` is loaded lazily inside safeFetch behind a server guard rather
// than imported at module top-level: this same module is reachable from a
// client component (Marketplace → mcp/client → safeFetch), and a static
// `node:dns` import would poison the browser bundle (Turbopack can't chunk a
// Node builtin for the client target). The browser path keeps the synchronous
// literal-host checks and relies on the browser's own CORS/same-origin sandbox.

// Returns true if a v4 literal is in a blocked range, false if it's public,
// null if the string isn't a v4 literal at all. Throws on malformed octets.
function classifyV4(host: string): boolean | null {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return null;
  const o = v4.slice(1).map((n) => parseInt(n, 10));
  if (o.some((x) => x < 0 || x > 255)) throw new Error("Invalid IP");
  const [a, b] = o;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) || // link-local + AWS/GCP metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224 // multicast / reserved
  );
}

function isBlockedV6(host: string): boolean {
  const v6 = host.toLowerCase();
  return (
    v6 === "::1" || // loopback
    v6 === "::" ||
    v6.startsWith("fc") || // unique-local
    v6.startsWith("fd") ||
    v6.startsWith("fe80") || // link-local
    v6.startsWith("::ffff:") // v4-mapped — may embed a private v4; block to be safe
  );
}

// Throws if a bare IP string (v4 or v6, no brackets) is in a blocked range.
function assertIpAllowed(ip: string): void {
  const v4 = classifyV4(ip);
  if (v4 === true) throw new Error("Blocked private IP");
  if (v4 === null && ip.includes(":") && isBlockedV6(ip)) {
    throw new Error("Blocked IPv6");
  }
}

export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs allowed");
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host === "metadata.goog"
  ) {
    throw new Error("Blocked host");
  }
  // Literal v4 IP in the host.
  if (classifyV4(host) === true) throw new Error("Blocked private IP");
  // Literal v6 IP — URL.hostname wraps it in brackets.
  if (host.startsWith("[")) {
    if (isBlockedV6(host.slice(1, -1))) throw new Error("Blocked IPv6");
  }
  return u;
}

// True when the host is an IP literal we've already validated synchronously
// (no DNS lookup needed/possible).
function isIpLiteral(host: string): boolean {
  return classifyV4(host) !== null || host.startsWith("[");
}

export async function safeFetch(rawUrl: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const safe = assertPublicHttpUrl(rawUrl);

  // DNS-rebind defense: for hostnames (not IP literals) resolve every A/AAAA
  // record and validate each against the private-range blocklist BEFORE we
  // fetch. Without this, `assertPublicHttpUrl` only sees the name, not where it
  // actually points — a public name with an internal A record bypasses it.
  // (Residual TOCTOU between this lookup and fetch's own resolution is
  // acceptable at hackathon scale; pinning the socket to the validated IP would
  // require a custom undici dispatcher.)
  const host = safe.hostname.toLowerCase();
  // Server-only: `node:dns` is unavailable in the browser, and the private-IP
  // SSRF threat only applies to server-originated fetches. `turbopackIgnore`
  // keeps the Node builtin out of the client chunk; the `window` guard keeps
  // the browser from ever evaluating it. A client caller falls back to the
  // synchronous literal-host checks above.
  if (typeof window === "undefined" && !isIpLiteral(host)) {
    const { lookup } = await import(/* turbopackIgnore: true */ "node:dns/promises");
    let resolved: Array<{ address: string }>;
    try {
      resolved = await lookup(host, { all: true });
    } catch {
      throw new Error("DNS resolution failed");
    }
    if (resolved.length === 0) throw new Error("No DNS records");
    for (const { address } of resolved) assertIpAllowed(address);
  }

  const ctl = new AbortController();
  const timeoutMs = init?.timeoutMs ?? 8000;
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(safe, {
      ...init,
      redirect: "manual",
      signal: ctl.signal,
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      // Re-validate redirect target through the same guard (incl. DNS) by
      // recursing — but only the URL check here; the recursive safeFetch on the
      // next hop (if any caller follows it) would re-resolve. We validate the
      // literal/host shape synchronously to fail fast on obvious internal hops.
      if (loc) assertPublicHttpUrl(new URL(loc, safe).toString());
    }
    return r;
  } finally {
    clearTimeout(t);
  }
}
