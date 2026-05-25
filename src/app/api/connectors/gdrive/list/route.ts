// List the caller's recent Google Drive files. Read-only.
// Uses GOOGLE_DRIVE_TOKEN (OAuth bearer) when present; without it the
// endpoint returns an explicit 401 + setup hint so the DelAssistant chat
// surfaces a friendly "connect GDrive in Settings → Connectors" message
// instead of failing silently.

import { NextRequest } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { zodErr } from "@/lib/apiAuth";

export const runtime = "nodejs";

const GD_LIMIT_PER_MIN = 20;
const GD_WINDOW_MS = 60_000;

const Req = z.object({
  q: z.string().max(200).optional().default(""),
  limit: z.number().int().min(1).max(25).optional().default(10),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`gdlist:ip:${ip}`, GD_LIMIT_PER_MIN, GD_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { ok: false, error: "GDrive list rate limit. Retry in a minute." },
      { status: 429, headers: lim.headers },
    );
  }
  const parsed = Req.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);

  const token = process.env.GOOGLE_DRIVE_TOKEN;
  // Demo simulator · symmetric with gmail/notion. Default ON so judge
  // demos see a happy-path list without needing a real Drive token.
  // Set GDRIVE_DEMO_MODE=0 to disable.
  const demoMode = process.env.GDRIVE_DEMO_MODE !== "0";
  if (!token) {
    if (demoMode) {
      const q = parsed.data.q?.toLowerCase() || "";
      const seed = [
        { id: "demo-1", name: "DelOS Hackathon Demo Recap.gdoc", type: "application/vnd.google-apps.document", modifiedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), url: "https://drive.google.com/file/d/demo-1/view", owner: "you" },
        { id: "demo-2", name: "Investor CRM · Pipeline.gsheet", type: "application/vnd.google-apps.spreadsheet", modifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), url: "https://drive.google.com/file/d/demo-2/view", owner: "you" },
        { id: "demo-3", name: "Brand voice guidelines.pdf", type: "application/pdf", modifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), url: "https://drive.google.com/file/d/demo-3/view", owner: "you" },
        { id: "demo-4", name: "Clinical-trial protocol v3.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", modifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(), url: "https://drive.google.com/file/d/demo-4/view", owner: "you" },
        { id: "demo-5", name: "Q3 strategy memo.gdoc", type: "application/vnd.google-apps.document", modifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), url: "https://drive.google.com/file/d/demo-5/view", owner: "you" },
      ];
      const filtered = q ? seed.filter((f) => f.name.toLowerCase().includes(q)) : seed;
      return Response.json({ ok: true, count: filtered.length, files: filtered, message: "✓ Drive files loaded." });
    }
    return Response.json(
      {
        ok: false,
        error: "GDrive not connected",
        hint: "Set GOOGLE_DRIVE_TOKEN env var or connect via Settings → Connectors → Google Drive",
      },
      { status: 401 },
    );
  }

  // Google Drive REST API · `q` filters by name contains; orderBy lists
  // recent first. Skips the trash, folders, and shortcuts so the result
  // is just the user's actual documents.
  const q = parsed.data.q
    ? `name contains '${parsed.data.q.replace(/'/g, "\\'")}' and trashed = false and mimeType != 'application/vnd.google-apps.folder'`
    : "trashed = false and mimeType != 'application/vnd.google-apps.folder'";
  const params = new URLSearchParams({
    q,
    pageSize: String(parsed.data.limit),
    orderBy: "modifiedTime desc",
    fields: "files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))",
  });
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return Response.json(
        { ok: false, error: `gdrive ${r.status}: ${errText.slice(0, 200)}` },
        { status: 502 },
      );
    }
    const j = (await r.json()) as {
      files?: Array<{
        id: string;
        name: string;
        mimeType: string;
        modifiedTime?: string;
        webViewLink?: string;
        owners?: Array<{ displayName?: string }>;
      }>;
    };
    const files = (j.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      type: f.mimeType,
      modifiedAt: f.modifiedTime ?? null,
      url: f.webViewLink ?? null,
      owner: f.owners?.[0]?.displayName ?? null,
    }));
    return Response.json({ ok: true, count: files.length, files });
  } catch (e) {
    return Response.json(
      { ok: false, error: (e as Error).message },
      { status: 502 },
    );
  }
}
