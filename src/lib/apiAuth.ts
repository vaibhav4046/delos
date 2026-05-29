// Server-side tenant + auth helpers shared by every /api/* route. Centralizes
// three patches surfaced in the 2026-05-24 brutal QA report:
//
//   1. resolveTenant()  — never trust tenantId from request body/query. Read
//                         it from the signed session cookie. If no session,
//                         scope the caller to a per-IP "anon-<sha8>" tenant
//                         so anonymous traffic still gets isolation. This
//                         closes BUG-1 (BOLA on /api/memory).
//
//   2. zodErr()         — every route was returning the raw multiline Zod
//                         issue blob (CWE-209 info disclosure, BUG-5). This
//                         helper normalizes to a compact JSON shape with at
//                         most three issues, each as { path, msg }.
//
//   3. sseDataSafe()    — strips embedded newlines from any text dropped
//                         into an SSE `data: …\n\n` frame. Closes the
//                         CVE-2026-33128 / GHSA-22cc-p3c6-wpvm SSE-injection
//                         class where attacker-controlled text could split
//                         events and forge `event: admin` lines.
//
// Plus a tiny in-Lambda registry for runId→tenant ownership so /api/steer
// can verify the caller owns the run before queueing instructions.

import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import type { ZodError } from "zod";
import { getServerSession } from "@/lib/session";
import { clientIp } from "@/lib/rateLimit";
import { env } from "@/lib/env";

export type ResolvedTenant = {
  tenantId: string;
  /**
   * Where the tenant came from. UI can show a chip "guest" vs "signed-in".
   * "client" = honored from a reserved test prefix or the public guest tenant
   * supplied by the caller — NOT an authenticated session. Never conflate the
   * two: a client-supplied tenant is not proof of ownership.
   */
  source: "session" | "client" | "anon-ip" | "fallback";
  email?: string;
};

// Reserved testing prefixes. Tenants with these prefixes are explicitly
// allowed to be set from request body/header/query when no session is
// present — QA and judges need rerun isolation without an account.
// Real user tenants never carry these prefixes (session-derived tenants
// use `t_<hash>`), so this can't be used to hop into another user's data.
const TEST_TENANT_RE = /^(qa|demo|test|judge|hack|hackathon)_[a-z0-9_-]{1,80}$/i;
// R12 · single canonical guest tenant for in-OS Memory Browser. Matching
// here lets the dashboard send `?tenantId=delrio_demo` (or its body field)
// without us treating it as BOLA. Auto-seed writes land here so a fresh
// `/os?guest=1` Memory Browser opens with the 12 seed entries.
const GUEST_TENANT = "delrio_demo";

/**
 * Resolve the calling tenant server-side. Caller MUST NOT pass tenantId in
 * request body or query for real user data — that is the BOLA vector.
 * This helper ignores untrusted input by default and returns the authoritative
 * value, with one exception: reserved testing prefixes (qa_/demo_/test_/...)
 * are honored when there's no session, so QA/judges can isolate reruns.
 *
 * Order:
 *   1. signed `delos_session` cookie  → user tenant
 *   2. reserved testing tenantId from body/header → isolated test scope
 *   3. per-IP anon tenant             → isolated guest scope
 *   4. env DELRIO_TENANT_ID fallback  → only when above all fail (dev/test)
 */
export async function resolveTenant(
  req: NextRequest,
  opts?: { bodyTenantId?: string; intent?: "read" | "write" },
): Promise<ResolvedTenant> {
  const session = await getServerSession();
  if (session) {
    return { tenantId: session.tenantId, source: "session", email: session.email };
  }
  // Look for an explicit testing tenant from body, X-Tenant header, or
  // ?tenant= query. Only accepted when it matches the reserved prefix —
  // never honored for arbitrary strings (which would be the BOLA vector).
  const headerTenant = req.headers.get("x-tenant") || req.headers.get("X-Tenant");
  // R12 · accept BOTH `?tenant=` (legacy) and `?tenantId=` (MemoryDashboard
  // + most clients use this). Was: only `?tenant=` which silently dropped
  // every dashboard request into anon-IP scope and made auto-seed land in
  // a different tenant than the recall query.
  const queryTenant =
    req.nextUrl?.searchParams?.get("tenant") ||
    req.nextUrl?.searchParams?.get("tenantId") ||
    undefined;
  const candidate = opts?.bodyTenantId || headerTenant || queryTenant || "";
  // Fail closed: default to "write" so a client-supplied `delrio_demo` is NOT
  // honored unless the route explicitly opts into a public-demo read with
  // `intent: "read"`. This protects every mutation route — current and future
  // — from a `?tenantId=delrio_demo` write poisoning the shared seed, without
  // needing each one to remember to pass intent:"write". Reserved test
  // prefixes (qa_/demo_/…) are still honored regardless of intent.
  const intent = opts?.intent ?? "write";
  if (candidate) {
    const isTest = TEST_TENANT_RE.test(candidate);
    // The guest tenant (delrio_demo) is SHARED, public seed data. Honor it for
    // reads (anyone may view the demo memories) but NEVER as a write/delete
    // target from client input — otherwise any anonymous caller could wipe or
    // poison the shared demo (`/api/memory/delete {all:true}`) or pollute the
    // Memory Browser everyone sees. Guest writes fall through to the per-IP
    // anon scope below, so each visitor mutates only their own copy.
    const isGuestRead = candidate === GUEST_TENANT && intent === "read";
    if (isTest) {
      // M5 · isolate reserved test/judge scopes PER-CALLER. Previously every
      // caller who passed the same reserved tenant (e.g. two judges both using
      // `judge_hydra2026` from the shared magic-link token) read AND wrote one
      // shared memory bag — a cross-user data bleed. Fold the per-IP hash into
      // the scope for BOTH read and write so each caller gets an isolated,
      // self-consistent view. (Same IP = same scope, so a single judge's own
      // session stays coherent across requests.)
      const ip = clientIp(req) || "unknown";
      if (ip && ip !== "unknown") {
        const h = createHash("sha256").update("anon:" + ip).digest("hex").slice(0, 8);
        return { tenantId: `${candidate}__${h}`, source: "client" };
      }
      return { tenantId: candidate, source: "client" };
    }
    if (isGuestRead) {
      // GUEST_TENANT (delrio_demo) is the SHARED public seed bag — intentionally
      // world-readable, already write-protected above. Not per-caller isolated.
      return { tenantId: candidate, source: "client" };
    }
  }
  const ip = clientIp(req) || "unknown";
  if (ip && ip !== "unknown") {
    const h = createHash("sha256").update("anon:" + ip).digest("hex").slice(0, 12);
    return { tenantId: `anon_${h}`, source: "anon-ip" };
  }
  return { tenantId: env.DELRIO_TENANT_ID || "delos_guest", source: "fallback" };
}

/**
 * Is this run's owning tenant one whose runs are intentionally shareable as a
 * public permalink? Seed/demo + reserved test/judge/qa scopes are part of the
 * public demo story (anyone with the link may view them). Real user runs
 * (session `t_*`/`u_*` and per-IP `anon_*`) are NOT shareable — reading those
 * cross-tenant is the BOLA the run-log routes must reject. Used by
 * /api/run-log + /api/run-log/[runId] to gate by ownership without breaking
 * the shareable demo run permalink.
 */
export function isShareableRunTenant(tenantId: string): boolean {
  if (!tenantId) return false;
  return tenantId === "demo-tenant" || tenantId === GUEST_TENANT || TEST_TENANT_RE.test(tenantId);
}

/**
 * Trusted base origin for links we generate server-side and hand to a third
 * party (magic-link emails, OAuth redirect_uri). MUST NOT be derived from the
 * request Host header — a forged `Host: evil.com` would otherwise poison a
 * victim's magic link into pointing at the attacker's domain (host-header
 * injection → account takeover once the victim clicks and the real token
 * lands on attacker infra).
 *
 * Order: explicit APP_BASE_URL / NEXT_PUBLIC_SITE_URL → Vercel-provided
 * production/deployment URL (set by the platform, not the client) → finally
 * the request origin (dev/localhost, where the Host is trusted).
 */
export function canonicalBaseUrl(req: NextRequest): string {
  const configured =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(req.url).origin;
}

/**
 * Convert a Zod parse failure into a clean, leak-free 400 JSON Response.
 * Never expose the raw `.error.message` blob — its multi-line layout also
 * triggers SSE-injection bugs downstream when a route forwards the string
 * verbatim into an event-stream `data:` field.
 */
export function zodErr(error: ZodError, status = 400): Response {
  const issues = (error.issues ?? []).slice(0, 3).map((i) => ({
    path: i.path.length ? i.path.join(".") : "(root)",
    msg: i.message,
  }));
  return new Response(
    JSON.stringify({ error: "validation_failed", issues }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Strip newlines and carriage returns from text destined for an SSE `data:`
 * field. The SSE wire format uses `\n\n` as the event terminator, so any
 * embedded `\n` lets attacker text inject `event:` / `id:` / `retry:` lines.
 * Call this on every dynamic string before it goes into an enqueued frame.
 */
export function sseDataSafe(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}

/**
 * Cross-request, single-Lambda binding of runId → owning tenant. Best-effort
 * (cleared on cold-start). Steer verification falls back to "queue if we
 * can't disprove ownership" for non-resident runs to preserve the cross-
 * Lambda streaming feature, but never accepts an explicit forged mismatch.
 */
const RUN_TENANT = new Map<string, { tenantId: string; at: number }>();
const RUN_BIND_TTL_MS = 30 * 60_000;

export function bindRun(runId: string, tenantId: string) {
  RUN_TENANT.set(runId, { tenantId, at: Date.now() });
  // Cheap pruning to keep the map bounded.
  if (RUN_TENANT.size > 500) {
    const cutoff = Date.now() - RUN_BIND_TTL_MS;
    for (const [k, v] of RUN_TENANT.entries()) {
      if (v.at < cutoff) RUN_TENANT.delete(k);
    }
  }
}

/**
 * Returns the bound tenant for a runId, or `null` if we don't know about it
 * (typically a different Lambda owned the run). Callers should treat null
 * as "uncertain" and decide whether to accept based on their threat model.
 */
export function getRunTenant(runId: string): string | null {
  const hit = RUN_TENANT.get(runId);
  if (!hit) return null;
  if (Date.now() - hit.at > RUN_BIND_TTL_MS) {
    RUN_TENANT.delete(runId);
    return null;
  }
  return hit.tenantId;
}
