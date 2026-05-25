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
import { getServerSession, deriveTenant } from "@/lib/session";
import { clientIp } from "@/lib/rateLimit";
import { env } from "@/lib/env";

export type ResolvedTenant = {
  tenantId: string;
  /** Where the tenant came from. UI can show a chip "guest" vs "signed-in". */
  source: "session" | "anon-ip" | "fallback";
  email?: string;
};

// Reserved testing prefixes. Tenants with these prefixes are explicitly
// allowed to be set from request body/header/query when no session is
// present — QA and judges need rerun isolation without an account.
// Real user tenants never carry these prefixes (session-derived tenants
// use `t_<hash>`), so this can't be used to hop into another user's data.
const TEST_TENANT_RE = /^(qa|demo|test|judge|hack|hackathon)_[a-z0-9_-]{1,80}$/i;

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
export async function resolveTenant(req: NextRequest, opts?: { bodyTenantId?: string }): Promise<ResolvedTenant> {
  const session = await getServerSession();
  if (session) {
    return { tenantId: session.tenantId, source: "session", email: session.email };
  }
  // Look for an explicit testing tenant from body, X-Tenant header, or
  // ?tenant= query. Only accepted when it matches the reserved prefix —
  // never honored for arbitrary strings (which would be the BOLA vector).
  const headerTenant = req.headers.get("x-tenant") || req.headers.get("X-Tenant");
  const queryTenant = req.nextUrl?.searchParams?.get("tenant") || undefined;
  const candidate = opts?.bodyTenantId || headerTenant || queryTenant || "";
  if (candidate && TEST_TENANT_RE.test(candidate)) {
    return { tenantId: candidate, source: "session" };
  }
  const ip = clientIp(req) || "unknown";
  if (ip && ip !== "unknown") {
    const h = createHash("sha256").update("anon:" + ip).digest("hex").slice(0, 12);
    return { tenantId: `anon_${h}`, source: "anon-ip" };
  }
  return { tenantId: env.DELRIO_TENANT_ID || "delos_guest", source: "fallback" };
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
