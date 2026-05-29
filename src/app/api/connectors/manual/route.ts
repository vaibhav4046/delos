// Manual connector credential paste.
// Bypasses OAuth — user pastes their personal access token directly.
// Token persisted per-user (scoped to session tenantId) in HydraDB.
// Works today for: Notion (integration token), GitHub (PAT), Linear (API key),
// HydraDB (own key), ElevenLabs, X, Slack bot token, Supabase service role.

import { z } from "zod";
import { NextRequest } from "next/server";
import { safeAddMemory } from "@/lib/hydra";
import { encryptSecret, redactToken } from "@/lib/secrets";
import { rateLimit, clientIp } from "@/lib/rateLimit";

import { resolveTenant, zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";

// Connector-credential paste is a target for brute-force probing — cap to
// 6/min per IP. Real user pastes 1-2 tokens at signup, not 6 per minute.
const CONNECTOR_LIMIT_PER_MIN = 6;
const CONNECTOR_WINDOW_MS = 60_000;

const bodySchema = z.object({
  connector: z.enum(["notion", "github", "linear", "hydradb", "elevenlabs", "x", "slack", "supabase"]),
  token: z.string().min(8).max(400),
  workspace: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`connector:ip:${ip}`, CONNECTOR_LIMIT_PER_MIN, CONNECTOR_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { ok: false, error: "Too many connector verifications. Try again in a minute." },
      { status: 429, headers: lim.headers },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return zodErr(parsed.error);
  }
  const { connector, token, workspace } = parsed.data;
  // SECURITY: a connector credential is a secret. Bind it to the caller's
  // resolved tenant (session → per-IP anon), NEVER the shared `delrio_demo`
  // seed tenant. Previously an unauthenticated paste fell back to the shared
  // tenant, so any other guest resolving there could drive connector actions
  // with the victim's token (cross-tenant credential reuse).
  const { tenantId } = await resolveTenant(req, { intent: "write" });

  // Lightly probe the token so we fail fast if it is obviously wrong.
  let verified = false;
  let verifyDetail = "";
  try {
    if (connector === "notion") {
      const r = await fetch("https://api.notion.com/v1/users/me", {
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" },
      });
      verified = r.ok;
      verifyDetail = r.ok ? "notion user lookup ok" : `notion ${r.status}`;
    } else if (connector === "github") {
      const r = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token}` },
      });
      verified = r.ok;
      verifyDetail = r.ok ? "github user lookup ok" : `github ${r.status}`;
    } else {
      // Other connectors: store without probe.
      verified = true;
      verifyDetail = "stored without probe";
    }
  } catch (e) {
    verified = false;
    verifyDetail = `probe error: ${(e as Error).message}`;
  }

  if (!verified) {
    return Response.json({ ok: false, error: "token failed to verify", detail: verifyDetail }, { status: 400 });
  }

  // SECURITY: never write the raw token into memory.text — that's the field
  // surfaced to recall queries + included in LLM context. Encrypt and stash
  // the ciphertext in metadata; text gets only a redacted preview.
  const tokenCipher = encryptSecret(token);
  await safeAddMemory({
    tenantId,
    text: `${connector.toUpperCase()}_CREDENTIAL token=${redactToken(token)} workspace=${workspace ?? ""} verified_at=${Date.now()}`,
    metadata: {
      connector,
      tags: ["connector-credential", connector],
      workspace,
      tokenCipher,
      // Fingerprint for dedupe — same token re-pasted shouldn't create dupes.
      tokenHash: redactToken(token),
    },
  });

  return Response.json({ ok: true, connector, tenant: tenantId, detail: verifyDetail });
}
