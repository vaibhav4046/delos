// Voice Router · transcript → structured VoiceIntent. Replaces the simpler
// /api/voice-command lightweight intent classifier with a fuller action
// vocabulary the OS shell + Chrome extension can dispatch against.
//
// Heuristic fast-path covers ~70% of common phrasings without spending a
// token; falls through to an LLM call only on fuzzier inputs. Tenant is
// resolved from session — body-supplied tenantId is ignored.

import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveTenant, zodErr, sseDataSafe } from "@/lib/apiAuth";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { generateText } from "ai";
import { createGroq } from "@ai-sdk/groq";

export const runtime = "nodejs";
export const maxDuration = 30;

const Req = z.object({
  transcript: z.string().min(1).max(800),
  context: z.array(z.string()).max(12).optional(),
  surface: z.enum(["web", "chrome", "mobile"]).default("web"),
});

const INTENTS = ["open","close","tile","theme","wallpaper","run","build","build_clone","cohort","summarize","screenshot","browser_action","answer","chain","unknown"] as const;
type IntentName = typeof INTENTS[number];

// Use `as z.ZodType<unknown>` annotation so the lazy self-reference type-checks.
type VoiceIntentT = {
  intent: typeof INTENTS[number];
  params?: Record<string, unknown>;
  chain?: VoiceIntentT[];
  speak: string;
};

export const VoiceIntentSchema: z.ZodType<VoiceIntentT> = z.object({
  intent: z.enum(INTENTS),
  params: z.record(z.string(), z.unknown()).optional(),
  chain: z.array(z.lazy(() => VoiceIntentSchema)).optional(),
  speak: z.string().max(300).default(""),
});

// ---------- Heuristic local matcher (no LLM call) ----------
function localMatch(t: string): { intent: IntentName; params?: Record<string, unknown>; speak: string } | null {
  const s = t.trim().toLowerCase();
  // Read / summarize current tab (chrome surface mostly)
  if (/^(read|tell me) (this( (page|tab))?|what (this )?(page|tab) says?)/.test(s)) {
    return { intent: "summarize", params: { mode: "read" }, speak: "Reading this page." };
  }
  if (/^(summari[sz]e|sum up|tl;?dr)/.test(s)) {
    return { intent: "summarize", params: { mode: "summary" }, speak: "Summarizing." };
  }
  // App open
  let m = s.match(/^(open|launch|show)\s+(?:the\s+)?(terminal|builder|app builder|cohort|arena|voice|memory|doom|browser|settings|notes|mission|files|calendar|ingest|cores|identity|del assistant|assistant)/);
  if (m) {
    const APP_ALIAS: Record<string, string> = { "app builder": "builder", "del assistant": "assistant" };
    const app = APP_ALIAS[m[2]] ?? m[2];
    return { intent: "open", params: { app }, speak: `Opening ${m[2]}.` };
  }
  // Tile shortcuts
  m = s.match(/^(tile|arrange|grid)( all| windows)?$/);
  if (m) return { intent: "tile", params: { layout: "grid" }, speak: "Tiling windows." };
  m = s.match(/^cascade(\s+windows)?$/);
  if (m) return { intent: "tile", params: { layout: "cascade" }, speak: "Cascading windows." };
  // Theme + wallpaper
  m = s.match(/^(switch|change|set) (?:to )?(?:the )?theme (?:to )?(.+)$/);
  if (m) return { intent: "theme", params: { themeId: m[2].trim() }, speak: `Switching theme to ${m[2]}.` };
  m = s.match(/^(set|change) (?:the )?wallpaper (?:to )?(.+)$/);
  if (m) return { intent: "wallpaper", params: { name: m[2].trim() }, speak: `Wallpaper changing.` };
  // Mission / build
  m = s.match(/^(run|start) mission (.+)$/);
  if (m) return { intent: "run", params: { goal: m[2].trim() }, speak: `Running mission.` };
  // "build a Twitter clone" / "build me a Notion clone" / "build a clone of X"
  m = s.match(/^build (?:me )?(?:an? )?(?:clone (?:of |for )?(.+)|(.+?)\s+clone\b)$/);
  if (m) {
    const target = (m[1] || m[2] || "").trim();
    return { intent: "build_clone", params: { inspiration: target }, speak: `Building a ${target} clone.` };
  }
  // Generic build (non-clone)
  m = s.match(/^build (?:me )?(?:an? )?(.+)$/);
  if (m) return { intent: "build", params: { spec: m[1].trim() }, speak: `Building ${m[1]}.` };
  // Cohort
  m = s.match(/^(cohort|race) (.+)$/);
  if (m) return { intent: "cohort", params: { prompt: m[2].trim() }, speak: `Running cohort race.` };
  // Browser actions in chrome surface
  m = s.match(/^(open|go to|visit) (.+)$/);
  if (m) return { intent: "browser_action", params: { kind: "navigate", target: m[2].trim() }, speak: `Opening ${m[2]}.` };
  m = s.match(/^(click|press|tap)\s+(?:on\s+)?(.+)$/);
  if (m) return { intent: "browser_action", params: { kind: "click", target: m[2].trim() }, speak: `Clicking ${m[2]}.` };
  return null;
}

const SYSTEM = `You are DelOS Voice Router. The user spoke; classify into one structured intent.
Return ONLY JSON: { "intent": "<one of: ${INTENTS.join("|")}>", "params": { ... }, "speak": "<1 sentence to read back>" }.
- "open" / "close" / "tile" target the OS shell. params.app, params.layout.
- "build_clone" for "build me a Twitter/Notion/Linear clone". params.inspiration.
- "build" for any custom AppSpec ("build me a calculator"). params.spec is the user goal.
- "run" for an agent mission. params.goal.
- "cohort" for race-N-models. params.prompt.
- "summarize" / "screenshot" / "browser_action" for current-tab tasks.
- "answer" if no action — params.reply contains the agent reply.
No prose. No markdown. Single JSON object.`;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`voicerouter:ip:${ip}`, 30, 60_000);
  if (!lim.ok) {
    return Response.json({ ok: false, error: "rate limited" }, { status: 429, headers: lim.headers });
  }
  const parsed = Req.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);
  const { tenantId } = await resolveTenant(req);
  const { transcript, surface } = parsed.data;

  // 1) Heuristic local match
  const local = localMatch(transcript);
  if (local) {
    return Response.json({ ok: true, source: "local", surface, tenantId, intent: local });
  }
  // 2) LLM fall-through (Groq scout-17b — fast + free tier).
  try {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) throw new Error("GROQ_API_KEY missing");
    const groq = createGroq({ apiKey: groqKey });
    const { text } = await generateText({
      model: groq("openai/gpt-oss-20b"),
      system: SYSTEM,
      prompt: `Transcript: ${sseDataSafe(transcript)}\n\nReturn JSON.`,
      temperature: 0.1,
    });
    const obj = JSON.parse(extractJson(text) ?? text);
    const intent = VoiceIntentSchema.parse(obj);
    return Response.json({ ok: true, source: "llm", surface, tenantId, intent });
  } catch (e) {
    return Response.json({
      ok: true,
      source: "fallback",
      surface,
      tenantId,
      intent: {
        intent: "answer",
        params: { reply: "I didn't catch that. Try again." },
        speak: "I didn't catch that. Try again.",
      },
      error: (e as Error).message,
    });
  }
}

function extractJson(s: string): string | null {
  const stripped = s.replace(/```(?:json)?/g, "").trim();
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return stripped.slice(first, last + 1);
}
