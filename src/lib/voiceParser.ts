// Deterministic voice-command parser. Runs BEFORE any LLM call so common
// intents (open / build / cohort / close / wallpaper / math / greet / read)
// resolve in microseconds with zero quota burn.
//
// Returns null if the transcript doesn't match any known pattern · caller
// falls through to the LLM classifier in that case.
//
// All patterns are anchored and ordered specific → general. Edits should
// preserve that ordering so a more-specific match never gets eaten by a
// generic one.

export type VoiceAction = {
  intent:
    | "open_app"
    | "build_app"
    | "run_cohort"
    | "run_mission"
    | "recall_memory"
    | "change_wallpaper"
    | "close_window"
    | "navigate"
    | "answer"
    | "unknown";
  app?: string;
  payload?: string;
  reply: string;
};

// App-id aliases — phonetic / common synonyms map to the canonical OS app id.
// Add aliases here, not in callers; keeps voice + chrome-ext + URL bar in sync.
const APP_ALIASES: Record<string, string> = {
  // Killer apps
  assistant: "assistant", delassistant: "assistant", chat: "assistant", del: "assistant", ask: "assistant",
  identity: "identity", profile: "identity", whoami: "identity",
  ingest: "ingest", upload: "ingest", vault: "ingest",
  terminal: "terminal", shell: "terminal", cli: "terminal",
  browser: "browser", browse: "browser", web: "browser",
  builder: "builder", build: "builder", appbuilder: "builder",
  codebase: "codebase", code: "codebase", codegen: "codebase",
  cohort: "cohort", council: "cohort", race: "cohort",
  cores: "cores", devfactory: "cores",
  arena: "arena", battleroyale: "arena", battle: "arena",
  voice: "voice", mic: "voice",
  cowork: "cowork", autonomous: "cowork",
  mission: "mission", missioncontrol: "mission", control: "mission",
  marketplace: "marketplace", tools: "marketplace", powerups: "marketplace",
  oss: "oss", osslibrary: "oss", opensource: "oss",
  analytics: "analytics", stats: "analytics", dashboard: "analytics",
  files: "files", filemanager: "files", explorer: "files", documents: "files",
  notes: "notes", stickynotes: "notes",
  calendar: "calendar", schedule: "calendar",
  calc: "calc", calculator: "calc", math: "calc",
  sysinfo: "sysinfo", systeminfo: "sysinfo", specs: "sysinfo",
  // Games
  snake: "snake", tictactoe: "tictactoe", memory: "memory",
  minesweeper: "minesweeper", game2048: "game2048", "2048": "game2048",
  doom: "doom", deldoom: "doom",
  // Settings / about
  settings: "settings", preferences: "settings", config: "settings",
  about: "about", info: "about", version: "about",
  // Branded retros
  claude: "claude", chatgpt: "chatgpt", perplexity: "perplexity",
};

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};

function wordToNum(w: string): number | null {
  const v = WORD_NUMBERS[w.toLowerCase()];
  return v ?? null;
}

function parseNum(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return parseFloat(t);
  // "seventeen", "twenty three"
  const parts = t.split(/\s+/);
  let total = 0;
  let lastWasTens = false;
  for (const p of parts) {
    const v = wordToNum(p);
    if (v == null) return null;
    if (v === 100 || v === 1000) {
      total = Math.max(1, total) * v;
    } else if (v >= 20 && v < 100) {
      total += v;
      lastWasTens = true;
    } else if (lastWasTens && v < 10) {
      total += v;
      lastWasTens = false;
    } else {
      total += v;
    }
  }
  return total > 0 || t === "zero" ? total : null;
}

// "open terminal and calculate 17 times 19" is two commands. We pick the
// LAST imperative — that's the action verb the user most recently uttered.
// "open X and Y" is the only case we explicitly chain, because users say
// it constantly. Otherwise the last verb wins.
function pickPrimary(text: string): string {
  const lower = text.toLowerCase().trim();
  // Strip filler heads.
  const stripped = lower.replace(/^(hey delos[,\s]+|delos[,\s]+|please[,\s]+|can you[,\s]+)/i, "");
  // If there's an "and" with a number-action after it, prefer that for math/calc.
  if (/\d|\b(plus|minus|times|over|equals?)\b/i.test(stripped)) {
    const tail = stripped.split(/\s+and\s+/).slice(-1)[0];
    if (tail && /\d|\b(plus|minus|times|over)\b/i.test(tail)) return tail.trim();
  }
  return stripped;
}

export function parseVoiceLocal(transcript: string): VoiceAction | null {
  const raw = String(transcript || "").trim();
  if (!raw) return null;
  const primary = pickPrimary(raw);
  const lower = primary.toLowerCase();

  // ─── 1. Greetings ───────────────────────────────────────────────────────
  if (/^(hi|hello|hey|yo|hola|hiya|sup|good\s+(morning|afternoon|evening))[\s.,!?]*$/i.test(lower)) {
    return { intent: "answer", payload: "Hey — what should we build?", reply: "Hey — what should we build?" };
  }

  // ─── 2. Math ─ digit OR word numbers · plus/minus/times/over/× × × ─────
  const mathDigit = lower.match(
    /(?:what\s+(?:is|are)\s+|calculate\s+|compute\s+)?(-?\d+(?:\.\d+)?)\s*(plus|minus|times|over|divided\s+by|\+|-|\*|x|\/)\s*(-?\d+(?:\.\d+)?)/i,
  );
  if (mathDigit) {
    const a = parseFloat(mathDigit[1]);
    const b = parseFloat(mathDigit[3]);
    const op = mathDigit[2].toLowerCase();
    const v = applyMath(a, b, op);
    if (v != null) {
      const r = Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, "");
      return { intent: "answer", payload: r, reply: r };
    }
  }
  // Word-number math · "seventeen times nineteen"
  const mathWord = lower.match(
    /(?:what\s+(?:is|are)\s+|calculate\s+|compute\s+)?([a-z\-\s]+?)\s+(plus|minus|times|over|divided\s+by)\s+([a-z\-\s]+?)(?:\s|$|[.,!?])/i,
  );
  if (mathWord) {
    const a = parseNum(mathWord[1]);
    const b = parseNum(mathWord[3]);
    const op = mathWord[2].toLowerCase();
    if (a != null && b != null) {
      const v = applyMath(a, b, op);
      if (v != null) {
        const r = Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, "");
        return { intent: "answer", payload: r, reply: r };
      }
    }
  }

  // ─── 3. Run cohort / council ────────────────────────────────────────────
  const cohort = lower.match(
    /(?:run\s+(?:a\s+)?cohort|council|race\s+(?:the\s+)?models?)\s+(?:on|about|for|with)?\s+(.{3,300})$/i,
  );
  if (cohort) {
    return {
      intent: "run_cohort",
      payload: cohort[1].trim(),
      reply: `Racing models on ${cohort[1].slice(0, 30)}.`,
    };
  }

  // ─── 4. Build app ───────────────────────────────────────────────────────
  // "build me an app named X" / "build X clone" / "create a dashboard for Y"
  const build = lower.match(
    /(?:^|[.,!]\s*)(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?(?:build|make|create|generate)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:app(?:lication)?|tool|widget|clone\s+of|website|webapp|dashboard|simulator)?\s*(?:named|called|titled|for|about)?\s*(.{2,400}?)$/i,
  );
  if (build) {
    const subject = build[1].trim().replace(/^["'`]|["'`]$/g, "");
    if (subject && !/^(it|that|one|this|something|anything)$/i.test(subject)) {
      return {
        intent: "build_app",
        payload: subject,
        reply: `Building ${subject.length > 40 ? subject.slice(0, 40) + "…" : subject}.`,
      };
    }
  }

  // ─── 5. Open app (with optional payload) ────────────────────────────────
  // "open terminal" / "open browser show me X" / "launch del assistant"
  const open = lower.match(
    /^(?:please\s+)?(?:open|launch|start|show\s+me|go\s+to)\s+(?:the\s+)?([a-z0-9 _-]{2,40})(?:\s+(.{1,200}))?[.!?]*$/i,
  );
  if (open) {
    const raw = open[1].trim().toLowerCase().replace(/\s+/g, "");
    const app = APP_ALIASES[raw] ?? raw;
    const detail = open[2]?.trim() ?? "";
    return {
      intent: "open_app",
      app,
      payload: detail,
      reply: `Opening ${app}${detail ? ` · ${detail.slice(0, 24)}` : ""}.`,
    };
  }

  // ─── 6. Recall memory ───────────────────────────────────────────────────
  const recall = lower.match(
    /^(?:recall|remember|what\s+(?:was|did|were)|show\s+me\s+my|find\s+my)\s+(.{2,300})$/i,
  );
  if (recall) {
    return {
      intent: "recall_memory",
      payload: recall[1].trim(),
      reply: `Recalling ${recall[1].slice(0, 30)}.`,
    };
  }

  // ─── 7. Wallpaper / close / navigate ────────────────────────────────────
  if (/(change|next|cycle|swap)\s+(?:the\s+)?(?:wall\s*paper|background)/i.test(lower)) {
    return { intent: "change_wallpaper", reply: "Wallpaper changed." };
  }
  if (/^(close|dismiss|exit)(\s+(this|window|the\s+window))?[.!?]*$/i.test(lower)) {
    return { intent: "close_window", reply: "Closed." };
  }
  if (/^(go\s+to|navigate\s+to|take\s+me\s+to)\s+(\/[a-z0-9\-_/]+)/i.test(lower)) {
    const m = lower.match(/(\/[a-z0-9\-_/]+)/i);
    if (m) return { intent: "navigate", payload: m[1], reply: `Going to ${m[1]}.` };
  }

  // ─── 8. Run mission · "research X" / "summarize Y" / "find me Z" ───────
  const mission = lower.match(
    /^(?:research|summarize|find\s+me|book\s+me|schedule|draft|send|write)\s+(.{3,400})$/i,
  );
  if (mission) {
    return {
      intent: "run_mission",
      payload: primary,
      reply: `Starting mission · ${primary.slice(0, 36)}.`,
    };
  }

  return null;
}

function applyMath(a: number, b: number, op: string): number | null {
  switch (op) {
    case "plus":
    case "+":
      return a + b;
    case "minus":
    case "-":
      return a - b;
    case "times":
    case "*":
    case "x":
    case "×":
      return a * b;
    case "over":
    case "divided by":
    case "/":
      return b === 0 ? null : a / b;
    default:
      return null;
  }
}
