type RoutePack = {
  re: RegExp;
  routes: string[];
  surfaces: string[];
};

const DEFAULT_ROUTES = ["/", "/dashboard", "/projects", "/clients", "/reports", "/settings"];
const DEFAULT_SURFACES = [
  "overview dashboard",
  "kanban workflow",
  "client portal",
  "time tracking",
  "invoice pipeline",
  "asset review",
  "analytics reports",
  "role permissions",
  "CSV export",
  "empty loading and error states",
];

const ROUTE_PACKS: RoutePack[] = [
  {
    re: /\b(investor|venture|vc|lp|capital|fund|deal\s+flow|portfolio|commitment|warm\s+intro)\b/i,
    routes: ["/", "/dashboard", "/deals", "/investors", "/follow-ups", "/portfolio", "/settings"],
    surfaces: [
      "investor pipeline",
      "commitment score",
      "warm intro tracker",
      "partner ownership",
      "diligence checklist",
      "follow-up queue",
      "portfolio exposure",
      "risk notes",
    ],
  },
  {
    re: /\b(regulatory|compliance|kyc|aml|sanction|sar|fintech|ofac|analyst\s+queue|alert\s+triage)\b/i,
    routes: ["/", "/dashboard", "/alerts", "/cases", "/evidence", "/sar-drafts", "/settings"],
    surfaces: [
      "sanctions screening",
      "KYC evidence",
      "analyst queue",
      "risk score",
      "alert triage",
      "SAR draft",
      "case timeline",
      "audit export",
    ],
  },
  {
    re: /\b(clinical|trial|patient|dosing|adverse|protocol|enroll|pharma|crf|site)\b/i,
    routes: ["/", "/dashboard", "/subjects", "/visits", "/adverse-events", "/protocol", "/settings"],
    surfaces: [
      "subject enrollment",
      "visit schedule",
      "dosing log",
      "adverse event workflow",
      "protocol deviation",
      "site performance",
      "CRF review",
      "monitoring export",
    ],
  },
  {
    re: /\b(legal|contract|redline|clause|attorney|counsel|obligation|nda|msa|sla|signature)\b/i,
    routes: ["/", "/dashboard", "/contracts", "/clauses", "/obligations", "/signatures", "/settings"],
    surfaces: [
      "clause library",
      "redline queue",
      "obligation tracker",
      "signature workflow",
      "party matrix",
      "renewal calendar",
      "counsel notes",
      "audit export",
    ],
  },
  {
    re: /\b(tutor|student|lesson|course|curriculum|quiz|mastery|learner|study\s+plan|education)\b/i,
    routes: ["/", "/dashboard", "/lessons", "/practice", "/quizzes", "/progress", "/settings"],
    surfaces: [
      "lesson plan",
      "mastery map",
      "practice queue",
      "quiz generator",
      "learner progress",
      "objective tracking",
      "feedback loop",
      "parent or coach report",
    ],
  },
  {
    re: /\b(incident|outage|oncall|on-call|postmortem|sre|sev\d|severity|runbook|paging)\b/i,
    routes: ["/", "/dashboard", "/incidents", "/runbooks", "/timeline", "/postmortems", "/settings"],
    surfaces: [
      "incident command",
      "severity matrix",
      "runbook checklist",
      "oncall rotation",
      "timeline",
      "rollback plan",
      "status broadcast",
      "postmortem actions",
    ],
  },
];

const STOPWORDS = new Set([
  "build",
  "make",
  "create",
  "generate",
  "from",
  "scratch",
  "with",
  "that",
  "this",
  "into",
  "full",
  "real",
  "app",
  "apps",
  "web",
  "site",
  "page",
  "dashboard",
  "system",
  "platform",
  "production",
  "level",
  "quality",
]);

function compact(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function pickRoutePack(prompt: string) {
  return ROUTE_PACKS.find((pack) => pack.re.test(prompt));
}

function inferRequestTerms(prompt: string) {
  return Array.from(
    new Set(
      prompt
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 4 && !STOPWORDS.has(word)),
    ),
  ).slice(0, 10);
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((v) => compact(v)).filter(Boolean)));
}

export function enhanceBuildPrompt(raw: string) {
  const base = compact(raw || "Build a production-level SaaS app");
  if (/PRODUCTION BUILD CONTRACT:/i.test(base)) return base;

  const pack = pickRoutePack(base);
  const routes = pack?.routes ?? DEFAULT_ROUTES;
  const requestTerms = inferRequestTerms(base);
  const surfaces = unique([...(pack?.surfaces ?? DEFAULT_SURFACES), ...requestTerms.map((t) => `${t} workflow`)]).slice(0, 14);

  return [
    base,
    "",
    "PRODUCTION BUILD CONTRACT:",
    "- Build from scratch as a sleek, production-level React/Next app, not a toy widget.",
    `- Include routes: ${routes.join(", ")}. If route folders are unavailable, render matching route tabs or sections in app/page.tsx.`,
    "- Include real domain mock data, stateful interactions, localStorage persistence, empty states, loading states, error states, validation, responsive desktop/mobile layout, and export/copy actions where relevant.",
    `- Required domain surfaces: ${surfaces.join("; ")}.`,
    "- Avoid generic placeholder copy. Name concrete entities, statuses, metrics, owners, permissions, due dates, risks, and next actions from the request.",
    "- Produce every file needed to run: package.json, app/page.tsx, components, data, lib helpers, and README.md.",
  ].join("\n");
}
