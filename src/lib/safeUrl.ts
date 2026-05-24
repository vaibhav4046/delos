// SSRF guard for any user-supplied URL we later fetch server-side.
// Blocks loopback / private / link-local / cloud-metadata / non-HTTP schemes,
// and re-checks the Location header on manual-redirect responses.

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
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map((n) => parseInt(n, 10));
    if (o.some((x) => x < 0 || x > 255)) throw new Error("Invalid IP");
    const [a, b] = o;
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    ) {
      throw new Error("Blocked private IP");
    }
  }
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1).toLowerCase();
    if (
      v6 === "::1" ||
      v6 === "::" ||
      v6.startsWith("fc") ||
      v6.startsWith("fd") ||
      v6.startsWith("fe80") ||
      v6.startsWith("::ffff:")
    ) {
      throw new Error("Blocked IPv6");
    }
  }
  return u;
}

export async function safeFetch(rawUrl: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const safe = assertPublicHttpUrl(rawUrl);
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
      if (loc) assertPublicHttpUrl(new URL(loc, safe).toString());
    }
    return r;
  } finally {
    clearTimeout(t);
  }
}
