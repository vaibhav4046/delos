import { NextRequest } from "next/server";
import { z } from "zod";
import { generateJson } from "@/lib/agents/jsonGen";
import { models, withModels, type ModelOverrides, type ModelKey } from "@/lib/llm";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 15;

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

// Accept both `transcript` (canonical) and `text` (alias for raw STT/ASR pipelines).
const bodySchema = z
  .object({
    transcript: z.string().min(1).max(800).optional(),
    text: z.string().min(1).max(800).optional(),
    models: z.object({ planner: modelKey, executor: modelKey, critic: modelKey }).partial().optional(),
  })
  .refine((d) => !!(d.transcript || d.text), {
    message: "either 'transcript' or 'text' is required",
  });

const actionSchema = z.object({
  intent: z.enum([
    "open_app",
    "run_mission",
    "build_app",
    "run_cohort",
    "recall_memory",
    "change_wallpaper",
    "close_window",
    "navigate",
    "answer",
    "unknown",
  ]),
  app: z.enum([
    "assistant", "identity", "ingest", "terminal", "browser", "builder",
    "cohort", "cores", "arena", "voice", "cowork", "mission", "marketplace",
    "analytics", "files", "notes", "calendar", "calc", "sysinfo",
    "snake", "tictactoe", "memory", "minesweeper", "game2048", "doom",
    "settings", "about", "claude", "chatgpt", "perplexity",
  ]).optional(),
  payload: z.string().max(800).optional(),
  reply: z.string().min(1).max(400),
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
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const overrides: ModelOverrides | undefined = parsed.data.models
    ? Object.fromEntries(Object.entries(parsed.data.models).filter(([, v]) => v) as Array<[string, ModelKey]>)
    : undefined;

  const prompt = `You interpret voice commands for a browser-OS called DelOS.

User said: "${parsed.data.transcript ?? parsed.data.text!}"

Map this to ONE action. Available intents:

- open_app: launch a system app. payload = goal/prompt to pre-fill if user gave one.
  app catalog (match phonetically + by purpose):
   • assistant — Del Assistant chat ("ask the assistant", "open del", "open chat")
   • identity — JarvisOS profile ("identity", "my profile", "who am I")
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
- build_app: open builder AND start building. payload = the app description.
  ALSO use build_app when the user asks for a productivity widget by name —
  kanban, pomodoro, tip calculator, habit tracker, expense tracker, contacts,
  chat room, stopwatch, poll booth, weather widget, notes, markdown editor.
  e.g. "open kanban" → build_app, payload="Kanban board with todo / doing /
  done columns". "make me a pomodoro" → build_app, payload="Pomodoro timer".
- run_cohort: open cohort AND start running with the goal. payload = the question.
- recall_memory: ask Del Assistant to recall something from memory. payload = the question / search query.
- change_wallpaper: cycle wallpaper. no payload.
- close_window: close focused window. no payload.
- navigate: navigate to a route. payload = "/", "/play", "/memory", "/os".
- answer: just speak a direct answer (greetings, simple math like "what is 2+2",
  simple fact, current time/date, "tell me a joke", greetings). payload = the
  spoken answer text. ALWAYS use this for math, greetings, and one-word
  factual questions instead of returning unknown.
- unknown: ONLY use this if the input is gibberish or empty. Default to answer
  for short factual / greeting questions.

Always include a short spoken "reply" (1 sentence, friendly) the system will speak back to the user confirming what it's doing.

Output JSON: { "intent": "...", "app": "...", "payload": "...", "reply": "..." }`;

  try {
    const obj = await withModels(overrides, () =>
      generateJson({
        model: models.executor,
        schema: actionSchema,
        prompt,
        temperature: 0.1,
      }),
    );
    return Response.json(obj);
  } catch (e) {
    // Don't leak the full Zod schema (with the entire app catalog) to clients.
    // Map JSON-validation failure to "unknown" intent so the voice UI can say
    // "I didn't catch that" instead of showing a 500 stack.
    const msg = e instanceof Error ? e.message : String(e);
    if (/generateJson failed|invalid_value|validation/i.test(msg)) {
      return Response.json({
        intent: "unknown",
        reply: "I didn't catch that — try again with a clearer command.",
      });
    }
    return Response.json({ error: "voice command failed" }, { status: 500 });
  }
}
