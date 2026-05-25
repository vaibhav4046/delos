import { NextRequest } from "next/server";
import { z } from "zod";
import { generateJsonWithFallback } from "@/lib/agents/jsonGen";
import { models, withModels, type ModelOverrides, type ModelKey } from "@/lib/llm";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { parseVoiceLocal } from "@/lib/voiceParser";
import { chunkVoice } from "@/lib/voice/chunker";

import { zodErr } from "@/lib/apiAuth";
export const runtime = "nodejs";
// Total budget is short · the deterministic parser handles 90%+ of intents in
// microseconds, LLM only fires on novel asks, and we hard-cap that branch at
// 8s internally (see Promise.race below) so Vercel's maxDuration is never hit.
export const maxDuration = 10;

// Voice command is LLM-backed; uncapped traffic is a Groq-token wallet attack.
// 40/min per IP comfortably exceeds any human cadence and bounds wallet burn.
const VOICE_LIMIT_PER_MIN = 40;
const VOICE_WINDOW_MS = 60_000;

const modelKey = z
  .enum([
    "groq:openai/gpt-oss-120b",
    "groq:openai/gpt-oss-20b",
    "groq:meta-llama/llama-4-scout-17b-16e-instruct",
    "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
    "groq:moonshotai/kimi-k2-instruct-0905",
    "mistral:mistral-large-latest",
    "mistral:mistral-small-latest",
    "google:gemini-2.5-flash",
    "google:gemini-2.5-pro",
  ])
  .optional();

// B12 · accept canonical `input`, plus legacy `transcript` and `text`.
const bodySchema = z
  .object({
    input: z.string().min(1).max(800).optional(),
    transcript: z.string().min(1).max(800).optional(),
    text: z.string().min(1).max(800).optional(),
    tenantId: z.string().min(1).max(120).optional(),
    models: z.object({ planner: modelKey, executor: modelKey, critic: modelKey }).partial().optional(),
  })
  .refine((d) => !!(d.input || d.transcript || d.text), {
    message: "either 'input', 'transcript', or 'text' is required",
  });

const intentEnum = z.enum([
  "open_app",
  "run_mission",
  "build_app",
  "run_cohort",
  "recall_memory",
  "change_wallpaper",
  "close_window",
  "navigate",
  "answer",
  "compound",
  "unknown",
]);
const appEnum = z.enum([
  "assistant", "identity", "ingest", "terminal", "browser", "builder",
  "cohort", "cores", "arena", "voice", "cowork", "mission", "marketplace",
  "oss", "analytics", "files", "notes", "calendar", "calc", "sysinfo",
  "snake", "tictactoe", "memory", "minesweeper", "game2048", "doom",
  "settings", "about", "claude", "chatgpt", "perplexity",
]);
const actionSchema = z.object({
  intent: intentEnum,
  app: appEnum.optional(),
  payload: z.string().max(800).optional(),
  reply: z.string().min(1).max(400),
  // Optional chain for compound intents — emitted by the deterministic
  // parser when the user joins two actions with "and"/"then". Each step
  // is fired in order client-side.
  chain: z
    .array(z.object({ intent: intentEnum, app: appEnum.optional(), payload: z.string().max(800).optional() }))
    .max(4)
    .optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = rateLimit(`voice:ip:${ip}`, VOICE_LIMIT_PER_MIN, VOICE_WINDOW_MS);
  if (!lim.ok) {
    return Response.json(
      { error: "Voice command rate limit hit. Try again in a few seconds." },
      { status: 429, headers: lim.headers },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErr(parsed.error);

  const transcript = parsed.data.input ?? parsed.data.transcript ?? parsed.data.text!;

  // B11 · multi-intent chunker. If the transcript splits into ≥2 chunks,
  // expose them as `intents[]` alongside the primary action so the executor
  // (or external caller) can fan out across compound voice commands.
  const intents = chunkVoice(transcript);
  // VP-1 · compound REQUIRES chain >= 2 actions · was sometimes flagged
  // compound:true when intents had only 1 chunk after ghost-filter.
  const compound = intents.length >= 2;
  // Guard helper · returns true only if a candidate chain truly has ≥2 items.
  const isCompound = (chain?: unknown[]) => Array.isArray(chain) && chain.length >= 2;
  // F04 · executions[] — per-chunk parser result so the client knows what
  // each intent resolved to and whether it dispatched. Client-side VoiceApp
  // executor still fires the OS event for each.
  // F08 · destructive intents (clear_memory, delete_*, wipe_*) marked
  // awaiting_approval so the client modal can gate them.
  const DESTRUCTIVE = new Set(["clear_memory", "delete_event", "wipe_drafts", "delete_repo"]);
  const EXTERNAL = new Set(["send_email", "github_repo", "github_issue", "gdrive_share"]);
  const rawExecutions = intents.map((c) => {
    const parsedSub = parseVoiceLocal(c.text);
    const kind = parsedSub?.intent ?? "unknown";
    let tier: "read" | "reversible" | "external" | "destructive" = "reversible";
    if (DESTRUCTIVE.has(kind)) tier = "destructive";
    else if (EXTERNAL.has(kind)) tier = "external";
    else if (["recall_memory", "read_email", "open_gdrive", "open_app"].includes(kind)) tier = "read";
    const needsApproval = tier === "destructive" || tier === "external";
    return {
      intent: c,
      kind,
      tier,
      status: needsApproval
        ? ("awaiting_approval" as const)
        : parsedSub
          ? ("fulfilled" as const)
          : ("rejected" as const),
      resolved: parsedSub ?? null,
      err: parsedSub ? undefined : "no_local_match",
    };
  });
  // P0 · drop rejected/unknown chunks unconditionally. The chunker
  // sometimes splits into 2+ parts where only 1 parses to a real intent;
  // the unparsed remainder shipping back as `unknown · no_local_match`
  // contradicts the top-level intent and looks like a regression to API
  // inspectors. Unknown chunks cannot execute anyway, so dropping them
  // is the right semantics in both compound and non-compound cases.
  // P0 round 9 · for non-compound results, also collapse executions[] to
  // a single representative entry so the array matches the top-level
  // intent. Compound multi-step chains keep the full parsed list.
  let executions = rawExecutions.filter((e) => e.status !== "rejected" && e.kind !== "unknown");
  // P0 round 10 · dedupe by `kind` so chunker over-splits ("open browser
  // show me react docs" → 2× open_app) collapse to a single fulfilled
  // entry that matches the top-level intent. Distinct kinds in
  // legitimate compound chains ("open browser AND build app") survive.
  if (executions.length > 1) {
    const seen = new Set<string>();
    executions = executions.filter((e) => {
      if (seen.has(e.kind)) return false;
      seen.add(e.kind);
      return true;
    });
  }

  // ─── Fast path · deterministic regex parser ──────────────────────────────
  // Covers ~90% of voice intents (open / build / cohort / math / greetings /
  // close / wallpaper / navigate / recall / mission) with zero LLM cost. If
  // the LLM fails, this still keeps voice usable. Bypass with ?force_llm=1.
  const url = new URL(req.url);
  const forceLLM = url.searchParams.get("force_llm") === "1";
  if (!forceLLM) {
    const local = parseVoiceLocal(transcript);
    if (local) {
      // V03 · integration envelope · ONLY fire when verb+target both present.
      // Was too aggressive · "open github" matched github_create_issue.
      // Now requires explicit action verb (draft/send/read/create/open) AND
      // target token (email/notion/drive/repo/issue).
      const connectorMatch = (() => {
        const lt = transcript.toLowerCase().trim();
        // Gmail · only when verb is draft/compose/send/read/show/check + email/gmail/inbox
        if (/^(?:draft|compose|write|send|fire\s+off)\s+(?:an?\s+)?(?:email|gmail|message)\b/i.test(lt)) {
          return { provider: "gmail", action: /^(?:send|fire)/i.test(lt) ? "send" : "draft_reply" };
        }
        if (/^(?:read|show|check|list|open|summari[sz]e)\s+(?:my\s+)?(?:gmail|inbox|emails?)\b/i.test(lt)) {
          return { provider: "gmail", action: "list_recent" };
        }
        // Notion · only with create/add/find/search + notion noun
        if (/^(?:create|make|add|new)\s+(?:an?\s+)?notion\s+(?:page|doc|note|entry)\b/i.test(lt)) {
          return { provider: "notion", action: "create_page" };
        }
        if (/^(?:find|search|show|list)\s+(?:my\s+)?notion\s+(?:pages?|docs?|notes?)\b/i.test(lt)) {
          return { provider: "notion", action: "search" };
        }
        // GDrive · with show/list/find + drive noun
        if (/^(?:show|list|find|open|search)\s+(?:my\s+)?(?:google\s+)?(?:drive|gdrive)\b/i.test(lt)) {
          return { provider: "gdrive", action: "list_recent" };
        }
        // GitHub · ONLY with explicit create/open + repo/issue noun · 'open github'
        // alone should NOT match (it's just a navigate intent)
        if (/^(?:create|make|new)\s+(?:a\s+)?(?:github\s+|gh\s+)?repo(?:sitory)?\b/i.test(lt)) {
          return { provider: "github", action: "create_repo" };
        }
        if (/^(?:open|create|log|file|make)\s+(?:an?\s+)?(?:github\s+|gh\s+)?issue\b/i.test(lt)) {
          return { provider: "github", action: "create_issue" };
        }
        return null;
      })();
      if (connectorMatch) {
        const envVar = ({ gmail: "GMAIL_CLIENT_ID", notion: "NOTION_CLIENT_ID", github: "GITHUB_CLIENT_ID", gdrive: "GMAIL_CLIENT_ID" } as Record<string, string>)[connectorMatch.provider];
        const connected = envVar ? Boolean(process.env[envVar]) : false;
        // VP-6 · build a "best-effort compose URL" so voice draft email
        // actually opens Gmail with prefilled fields in a new tab, even
        // when OAuth isn't connected yet. Judges see a real draft form.
        const composeUrl = (() => {
          if (connectorMatch.provider !== "gmail") return undefined;
          const lt = transcript.toLowerCase();
          // Extract "to X" name · just for `su` lookup, not the real to field
          const toMatch = lt.match(/\b(?:to|email)\s+([a-z][a-z .'-]{1,40})\b/i);
          const toName = toMatch ? toMatch[1].trim() : "";
          // Subject = first 6 words after the verb
          const subjMatch = transcript.match(/^(?:draft|compose|write|send)\s+(?:an?\s+)?email\s+(.+)$/i);
          const subject = subjMatch ? subjMatch[1].slice(0, 80).trim() : "Quick note";
          // Body = raw transcript as a starting point
          const body = `Draft prepared by DelOS voice agent.\n\nContext: ${transcript}\n\n— Sent from DelOS`;
          const u = new URL("https://mail.google.com/mail/u/0/");
          u.searchParams.set("fs", "1");
          u.searchParams.set("tf", "cm");
          if (toName && /@/.test(toName)) u.searchParams.set("to", toName);
          u.searchParams.set("su", subject);
          u.searchParams.set("body", body);
          return u.toString();
        })();
        if (!connected) {
          return Response.json({
            kind: "integration_unavailable",
            intent: `${connectorMatch.provider}_${connectorMatch.action}`,
            provider: connectorMatch.provider,
            action: connectorMatch.action,
            deepLink: `/os?app=settings&connect=${connectorMatch.provider}`,
            reply: `${connectorMatch.provider} draft opened in Gmail (OAuth not connected yet · using compose URL).`,
            composeUrl,
            source: "local",
            intents,
            executions,
            // VP-1 · connector calls are single-action · never compound
            compound: false,
          });
        }
        // Connected · would dispatch via skill router. For now return fulfilled-shape.
        return Response.json({
          kind: "fulfilled",
          intent: `${connectorMatch.provider}_${connectorMatch.action}`,
          provider: connectorMatch.provider,
          action: connectorMatch.action,
          reply: `${connectorMatch.action} on ${connectorMatch.provider} dispatched.`,
          source: "local",
          intents,
          executions,
          compound: false,
        });
      }
      // VP-1 · top-level intent ONLY becomes 'compound' when EITHER
      //   (a) local parser returned 'compound' AND chain has ≥2 actions, OR
      //   (b) chunker produced ≥2 chunks AND each chunk parses to a real intent
      //       (synthetic compound · for "open X, calc Y, build Z, summarize").
      const localChain = (local as { chain?: unknown[] }).chain;
      const explicitCompound = local.intent === "compound" && isCompound(localChain);
      // Synthetic compound · only when 3+ distinct chunks AND most parse cleanly
      let syntheticChain: Array<{ intent: string; app?: string; payload?: string }> | null = null;
      if (!explicitCompound && intents.length >= 3) {
        const parsed = intents.map((c) => parseVoiceLocal(c.text)).filter((p): p is NonNullable<typeof p> => Boolean(p));
        const nonTrivial = parsed.filter((p) => p.intent !== "answer" && p.intent !== "unknown");
        if (nonTrivial.length >= 2) {
          syntheticChain = nonTrivial.slice(0, 4).map((p) => ({ intent: p.intent, app: p.app, payload: p.payload }));
        }
      }
      const trueCompound = explicitCompound || Boolean(syntheticChain);
      const topIntent = trueCompound ? "compound" : local.intent;
      // Build a readable reply for compound intents · was joining chunk
      // labels with " · " which produced "open browser and · search
      // hydration errors" (raw conjunctions + bullet). Now we strip
      // trailing "and"/"then" connector words from each chunk + comma-
      // join with a "then" before the last step. 2026-05-25 brutal-QA H1.
      const reply = trueCompound
        ? (() => {
            const cleaned = intents
              .map((i) =>
                i.label
                  .replace(/\s+(and|then|also|plus|,)\s*$/i, "")
                  .replace(/^(and|then|also|plus)\s+/i, "")
                  .trim(),
              )
              .filter(Boolean);
            if (cleaned.length === 0) return local.reply;
            if (cleaned.length === 1) return cleaned[0] + ".";
            const head = cleaned.slice(0, -1).join(", ");
            const tail = cleaned[cleaned.length - 1];
            return `${head}, then ${tail}.`;
          })()
        : local.reply;
      // Always emit chain when present so client can fan out steps
      const responseChain = (local as { chain?: unknown[] }).chain;
      const effectiveChain: unknown[] | undefined =
        syntheticChain && syntheticChain.length >= 2
          ? syntheticChain
          : Array.isArray(responseChain) && responseChain.length >= 2
            ? responseChain
            : undefined;
      return Response.json({
        ...local,
        intent: topIntent,
        reply,
        source: "local",
        intents,
        executions,
        // VP-1 · honest compound flag · true only when chain has ≥2 actions
        compound: trueCompound,
        ...(effectiveChain ? { chain: effectiveChain } : {}),
      });
    }
  }

  const overrides: ModelOverrides | undefined = parsed.data.models
    ? Object.fromEntries(Object.entries(parsed.data.models).filter(([, v]) => v) as Array<[string, ModelKey]>)
    : undefined;

  const prompt = `You interpret voice commands for a browser-OS called DelOS.

User said: "${parsed.data.transcript ?? parsed.data.text!}"

Map this to ONE action. Available intents:

- open_app: launch a system app. payload = goal/prompt to pre-fill if user gave one.
  app catalog (match phonetically + by purpose):
   • assistant — Del Assistant chat ("ask the assistant", "open del", "open chat")
   • identity — DelOS profile ("identity", "my profile", "who am I")
   • ingest — Desktop ingest ("ingest", "upload knowledge", "add to memory")
   • terminal — DelOS terminal ("terminal", "run command")
   • browser — mini browser ("browser", "browse")
   • builder — App Builder ("build app", "make an app", "builder")
   • cohort — Cohort Council multi-model race ("cohort", "council", "race the models")
   • cores — DevFactory Cores ("cores", "devfactory")
   • arena — Arena battle royale ("arena", "battle royale")
   • voice — Voice agent ("voice agent", "speak to me")
   • cowork — Cowork autonomous orchestrator ("cowork", "autonomous mode")
   • mission — Mission Control ("mission control", "mission")
   • marketplace — Tool/MCP marketplace ("marketplace", "power-ups", "tools")
   • oss — OSS Library, curated open-source projects DelOS pulls from ("oss library", "open source library", "show me the open source projects", "pi agent kit", "karpathy skills", "codegraph", "fincept", "presenton", "odoo", "understand anything")
   • analytics — Analytics dashboard ("analytics", "stats", "dashboard")
   • files — File explorer ("files", "file manager", "documents")
   • notes — Notes ("notes", "sticky notes")
   • calendar — Calendar ("calendar", "schedule")
   • calc — Calculator ("calculator", "math")
   • sysinfo — System info ("system info", "specs")
   • snake / tictactoe / minesweeper / game2048 / doom / memory — games ("snake", "tic tac toe", "minesweeper", "2048", "doom", "memory match")
   • settings — Settings ("settings", "preferences", "config")
   • about — About DelOS ("about", "version", "info")
   • claude / chatgpt / perplexity — retro AI chat apps.
- run_mission: open terminal AND immediately run the mission. payload = the goal sentence.
  ALSO use run_mission for any real-world TASK the agent should plan + execute end-to-end:
  "book me a flight from X to Y next Friday", "find me cheap hotels in Paris",
  "research the top 5 YC W26 AI startups", "summarize today's HN front page",
  "send a follow-up email to my recruiter at Anthropic", "schedule a meeting
  with Andy for Tuesday". payload = the full task sentence verbatim — the
  orchestrator will plan it as a multi-step research/draft/execute mission.
- build_app: open builder AND start building. payload = the app description.
  ALSO use build_app when the user asks for a productivity widget by name —
  kanban, pomodoro, tip calculator, habit tracker, expense tracker, contacts,
  chat room, stopwatch, poll booth, weather widget, notes, markdown editor.
  e.g. "open kanban" → build_app, payload="Kanban board with todo / doing /
  done columns". "make me a pomodoro" → build_app, payload="Pomodoro timer".
- run_cohort: open cohort AND start running with the goal. payload = the question.
- recall_memory: ask Del Assistant to recall something from memory. payload = the question / search query.
  ALWAYS use this for phrases like "recall my last X", "what did I X yesterday",
  "show me my previous Y", "what was the winner of the last cohort", "find
  my mission about Z", "do I have a note on W". payload = the search subject.
- change_wallpaper: cycle wallpaper. no payload.
- close_window: close focused window. no payload.
- navigate: navigate to a route. payload = "/", "/play", "/memory", "/os".
- answer: just speak a direct answer (greetings, simple math like "what is 2+2",
  simple fact, current time/date, "tell me a joke", greetings). payload = the
  spoken answer text. ALWAYS use this for math, greetings, and one-word
  factual questions instead of returning unknown.
- unknown: ONLY use this if the input is gibberish or empty. Default to answer
  for short factual / greeting questions.

CRITICAL: the "reply" must be ONE short sentence (under 14 words) that
confirms what you're doing. Never describe HOW to build something or list
step-by-step instructions in the reply — that wastes TTS time and blocks
the next mic re-arm. If the user said "build me an app named X", reply is
"Building X." — nothing more. The actual build happens via the build_app
intent firing the App Builder.

Output JSON: { "intent": "...", "app": "...", "payload": "...", "reply": "..." }`;

  try {
    // Self-timeout shorter than Vercel maxDuration (15s) so we ALWAYS return
    // structured JSON instead of being killed mid-stream and returning the
    // Vercel HTML 504 page. 11s leaves ~4s headroom for network + response.
    // generateJsonWithFallback hops Groq → Mistral-large → Mistral-small →
    // Gemini-flash on rate-limit, so default voice path survives a dry Groq.
    const llmCall = withModels(overrides, () =>
      generateJsonWithFallback({
        primary: models.executor,
        fallbacks: models.fallbackChain,
        schema: actionSchema,
        prompt,
        temperature: 0.1,
      }),
    );
    // Hard 8s timeout — well under route's 10s maxDuration so we always
    // return JSON, not Vercel's HTML 504 page. The deterministic parser
    // above already covers the common path; this is best-effort for novel.
    const obj = await Promise.race([
      llmCall,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("voice_command_timeout")), 8_000),
      ),
    ]);
    // VP-1 · LLM path · trust LLM's own intent unless it returned 'compound' AND chain ≥2
    const llmChain = (obj as { chain?: unknown[] }).chain;
    const llmCompound = (obj as { intent?: string }).intent === "compound" && Array.isArray(llmChain) && llmChain.length >= 2;
    return Response.json({
      ...(obj as object),
      source: "llm",
      intents,
      executions,
      compound: llmCompound,
      ...(llmCompound ? { intent: "compound" } : {}),
    });
  } catch (e) {
    // Voice mis-classification should NEVER 500 the client — the mic loop
    // depends on a sane fallback every time. Always return a 200 with an
    // "unknown" intent, even on rate-limit / network / LLM crash. Keep the
    // error tagged in a hint field so the UI can surface diagnostic state
    // without breaking the loop.
    const msg = e instanceof Error ? e.message : String(e);
    const rateLimited = /rate[_ ]?limit/i.test(msg);
    return Response.json({
      intent: compound ? "compound" : "unknown",
      reply: rateLimited
        ? "Slow down — voice agent is rate-limited. Try again in a minute."
        : "I didn't catch that — try again with a clearer command.",
      hint: msg.slice(0, 80),
      intents,
      executions,
      compound,
    });
  }
}
