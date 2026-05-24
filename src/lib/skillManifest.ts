// Skill manifest — declares risk level + approval requirement for every voice
// intent. Foundation for the architecture's "agent should not act on
// irreversible things without final user approval" rule.

export type RiskLevel = "read" | "draft" | "reversible" | "external" | "money" | "destructive";

export type SkillManifest = {
  intent: string;          // matches voice-command intent enum
  label: string;           // human-friendly label shown in approval modal
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  description: string;
};

export const SKILL_MANIFEST: Record<string, SkillManifest> = {
  open_app: {
    intent: "open_app",
    label: "Open app",
    riskLevel: "reversible",
    requiresApproval: false,
    description: "Launch a system app window. Easy to close.",
  },
  run_mission: {
    intent: "run_mission",
    label: "Run agent mission",
    riskLevel: "read",
    requiresApproval: false,
    description: "Plan + execute a read-only mission. No external side effects.",
  },
  build_app: {
    intent: "build_app",
    label: "Build an app",
    riskLevel: "reversible",
    requiresApproval: false,
    description: "Generate an app spec + mount as a window. No deploy.",
  },
  run_cohort: {
    intent: "run_cohort",
    label: "Race multiple models",
    riskLevel: "read",
    requiresApproval: false,
    description: "Run 3+ models in parallel + judge.",
  },
  recall_memory: {
    intent: "recall_memory",
    label: "Recall memory",
    riskLevel: "read",
    requiresApproval: false,
    description: "Read-only HydraDB query.",
  },
  change_wallpaper: {
    intent: "change_wallpaper",
    label: "Change wallpaper",
    riskLevel: "reversible",
    requiresApproval: false,
    description: "Cycle desktop wallpaper.",
  },
  close_window: {
    intent: "close_window",
    label: "Close focused window",
    riskLevel: "reversible",
    requiresApproval: false,
    description: "Closes the currently focused window. Re-openable.",
  },
  navigate: {
    intent: "navigate",
    label: "Navigate",
    riskLevel: "reversible",
    requiresApproval: false,
    description: "Switch route inside DelOS.",
  },
  answer: {
    intent: "answer",
    label: "Speak answer",
    riskLevel: "read",
    requiresApproval: false,
    description: "Direct spoken answer, no side effect.",
  },
  // Future intents — pre-declared with proper approval rules so adding the
  // implementation doesn't require a separate security review.
  deploy: {
    intent: "deploy",
    label: "Deploy publicly",
    riskLevel: "external",
    requiresApproval: true,
    description: "Push code to Vercel / Cloudflare. Visible to the public.",
  },
  send_email: {
    intent: "send_email",
    label: "Send email",
    riskLevel: "external",
    requiresApproval: true,
    description: "Sends mail to real recipients via Gmail / Resend.",
  },
  pay: {
    intent: "pay",
    label: "Make payment",
    riskLevel: "money",
    requiresApproval: true,
    description: "Moves money. Stripe / card / wallet.",
  },
  book_ticket: {
    intent: "book_ticket",
    label: "Book ticket",
    riskLevel: "money",
    requiresApproval: true,
    description: "Books a flight / train / event seat — usually paid.",
  },
  delete_data: {
    intent: "delete_data",
    label: "Delete data",
    riskLevel: "destructive",
    requiresApproval: true,
    description: "Removes memory / files / repos. Not always reversible.",
  },
};

export function getSkill(intent: string): SkillManifest | null {
  return SKILL_MANIFEST[intent] ?? null;
}

export function requiresApproval(intent: string): boolean {
  return getSkill(intent)?.requiresApproval ?? false;
}

export function riskColor(level: RiskLevel): string {
  switch (level) {
    case "read":
    case "draft":
      return "var(--success)";
    case "reversible":
      return "var(--accent)";
    case "external":
      return "var(--warn)";
    case "money":
    case "destructive":
      return "var(--danger)";
  }
}
