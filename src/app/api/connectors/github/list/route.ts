// List the caller's GitHub repositories. Uses GITHUB_TOKEN when present
// for private repos; falls back to public unauthenticated search when not.
// Read-only — never writes to the repo. Powered by the Del Assistant
// "show my repos" autonomous action.

import { NextRequest } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

const GH_LIMIT_PER_MIN = 20;
const GH_WINDOW_MS = 60_000;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`ghlist:ip:${ip}`, GH_LIMIT_PER_MIN, GH_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { ok: false, error: "GitHub list rate limit. Retry in a minute." },
      { status: 429, headers: lim.headers },
    );
  }

  const token = process.env.GITHUB_TOKEN;
  const url = token
    ? "https://api.github.com/user/repos?per_page=15&sort=updated"
    : // Fallback · vaibhav's public repos when no auth token is wired. The
      // assistant explains the caveat in the response so the user knows.
      "https://api.github.com/users/vaibhav4046/repos?per_page=15&sort=updated";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "DelOS/2.2",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return Response.json(
        { ok: false, error: `github ${r.status}: ${errText.slice(0, 200)}` },
        { status: 502 },
      );
    }
    const j = (await r.json()) as Array<{
      full_name: string;
      description: string | null;
      updated_at: string;
      stargazers_count: number;
      private?: boolean;
    }>;
    const repos = j.map((r) => ({
      full_name: r.full_name,
      description: r.description ?? undefined,
      updated_at: r.updated_at,
      stars: r.stargazers_count,
      private: r.private ?? false,
    }));
    return Response.json({
      ok: true,
      authenticated: Boolean(token),
      count: repos.length,
      repos,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: (e as Error).message },
      { status: 502 },
    );
  }
}
