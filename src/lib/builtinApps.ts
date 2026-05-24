// Pre-built AppSpec library — instant install, no LLM round-trip.
// Each app is a complete, working AppSpec validated against appSpecSchema.
// Wired into /builder Quick Install + /api/builtin-apps.

import type { AppSpec } from "./appSpec";

export const BUILTIN_APPS: AppSpec[] = [
  {
    id: "kanban-board",
    name: "Kanban Board",
    icon: "Kanban",
    width: 560,
    height: 520,
    initialState: { newItem: "", todo: [], doing: [], done: [] },
    root: {
      kind: "col",
      gap: 3,
      children: [
        { kind: "text", value: "Kanban Board", size: "h2" },
        { kind: "text", value: "Drag work across columns. Add items to TODO.", size: "body" },
        {
          kind: "row",
          gap: 2,
          children: [
            { kind: "input", bind: "newItem", placeholder: "new task…" },
            {
              kind: "button",
              label: "+ Add",
              variant: "primary",
              actions: [
                { kind: "push", listKey: "todo", valueTemplate: "{{newItem}}" },
                { kind: "set", key: "newItem", value: "" },
              ],
            },
          ],
        },
        { kind: "divider" },
        {
          kind: "row",
          gap: 3,
          children: [
            {
              kind: "card",
              children: [
                { kind: "text", value: "TODO", size: "h3" },
                { kind: "list", bindKey: "todo", itemTemplate: "[ ] {{item}}", emptyText: "no todos yet" },
                {
                  kind: "button",
                  label: "→ start next",
                  variant: "ghost",
                  actions: [
                    { kind: "agent", promptTemplate: "Pick top todo from {{todo}} and move to doing.", saveAs: "_aiPick" },
                  ],
                },
              ],
            },
            {
              kind: "card",
              children: [
                { kind: "text", value: "DOING", size: "h3" },
                { kind: "list", bindKey: "doing", itemTemplate: "▶ {{item}}", emptyText: "nothing in progress" },
              ],
            },
            {
              kind: "card",
              children: [
                { kind: "text", value: "DONE", size: "h3" },
                { kind: "list", bindKey: "done", itemTemplate: "✓ {{item}}", emptyText: "nothing done" },
                {
                  kind: "button",
                  label: "clear done",
                  variant: "danger",
                  actions: [{ kind: "clear", key: "done" }],
                },
              ],
            },
          ],
        },
      ],
    },
  },

  {
    id: "markdown-editor",
    name: "Markdown Editor",
    icon: "FileText",
    width: 640,
    height: 520,
    initialState: { content: "# Hello DelOS\n\nWrite **markdown** here. Click _Save_ to keep it.", saved: "" },
    root: {
      kind: "col",
      gap: 3,
      children: [
        { kind: "text", value: "Markdown Editor", size: "h2" },
        { kind: "input", bind: "content", type: "textarea", placeholder: "# start typing markdown…" },
        {
          kind: "row",
          gap: 2,
          children: [
            {
              kind: "button",
              label: "Save",
              variant: "primary",
              actions: [
                { kind: "set", key: "saved", value: "{{content}}" },
                { kind: "tool", tool: "notes_append", argsTemplate: { text: "{{content}}" } },
                { kind: "notify", text: "Saved to notes" },
              ],
            },
            {
              kind: "button",
              label: "AI polish",
              variant: "ghost",
              actions: [
                { kind: "agent", promptTemplate: "Improve this markdown: {{content}}", saveAs: "content" },
              ],
            },
            {
              kind: "button",
              label: "Summarize",
              variant: "ghost",
              actions: [
                { kind: "tool", tool: "summarize", argsTemplate: { text: "{{content}}" }, saveAs: "summary" },
              ],
            },
          ],
        },
        { kind: "divider" },
        { kind: "text", value: "Preview", size: "h3" },
        { kind: "text", value: "{{content}}", size: "mono" },
        { kind: "pill", text: "saved {{saved}}", tone: "ok", if: "saved" },
      ],
    },
  },

  {
    id: "expense-tracker",
    name: "Expense Tracker",
    icon: "DollarSign",
    width: 480,
    height: 540,
    initialState: { label: "", amount: "0", expenses: [], total: 0 },
    root: {
      kind: "col",
      gap: 3,
      children: [
        { kind: "text", value: "Expense Tracker", size: "h2" },
        { kind: "text", value: "Total: ${{total}}", size: "h3" },
        {
          kind: "row",
          gap: 2,
          children: [
            { kind: "input", bind: "label", placeholder: "what for…" },
            { kind: "input", bind: "amount", type: "number", placeholder: "$" },
          ],
        },
        {
          kind: "button",
          label: "+ Add expense",
          variant: "primary",
          actions: [
            { kind: "push", listKey: "expenses", valueTemplate: "{{label}} — ${{amount}}" },
            { kind: "inc", key: "total", by: 1 },
            { kind: "set", key: "label", value: "" },
            { kind: "set", key: "amount", value: "0" },
          ],
        },
        { kind: "divider" },
        { kind: "list", bindKey: "expenses", itemTemplate: "{{item}}", emptyText: "no expenses logged" },
        {
          kind: "button",
          label: "Reset all",
          variant: "danger",
          actions: [
            { kind: "clear", key: "expenses" },
            { kind: "set", key: "total", value: "0" },
          ],
        },
      ],
    },
  },

  {
    id: "habit-tracker",
    name: "Habit Tracker",
    icon: "Target",
    width: 480,
    height: 520,
    initialState: { habit: "", habits: [], streak: 0 },
    root: {
      kind: "col",
      gap: 3,
      children: [
        { kind: "text", value: "Habit Tracker", size: "h2" },
        { kind: "text", value: "Streak: {{streak}} days 🔥", size: "h3" },
        {
          kind: "row",
          gap: 2,
          children: [
            { kind: "input", bind: "habit", placeholder: "new habit…" },
            {
              kind: "button",
              label: "+ Track",
              variant: "primary",
              actions: [
                { kind: "push", listKey: "habits", valueTemplate: "{{habit}}" },
                { kind: "set", key: "habit", value: "" },
              ],
            },
          ],
        },
        { kind: "divider" },
        { kind: "list", bindKey: "habits", itemTemplate: "○ {{item}}", emptyText: "no habits yet" },
        {
          kind: "row",
          gap: 2,
          children: [
            {
              kind: "button",
              label: "✓ Did today",
              variant: "success",
              actions: [
                { kind: "inc", key: "streak", by: 1 },
                { kind: "notify", text: "Streak +1" },
              ],
            },
            {
              kind: "button",
              label: "Reset streak",
              variant: "danger",
              actions: [{ kind: "set", key: "streak", value: "0" }],
            },
          ],
        },
      ],
    },
  },

  {
    id: "contacts-crm",
    name: "Contacts CRM",
    icon: "Users",
    width: 540,
    height: 540,
    initialState: { name: "", email: "", company: "", contacts: [] },
    root: {
      kind: "col",
      gap: 3,
      children: [
        { kind: "text", value: "Contacts CRM", size: "h2" },
        { kind: "input", bind: "name", placeholder: "full name…" },
        { kind: "input", bind: "email", placeholder: "email@example.com" },
        { kind: "input", bind: "company", placeholder: "company (optional)" },
        {
          kind: "button",
          label: "+ Add contact",
          variant: "primary",
          actions: [
            { kind: "push", listKey: "contacts", valueTemplate: "{{name}} · {{email}} · {{company}}" },
            { kind: "set", key: "name", value: "" },
            { kind: "set", key: "email", value: "" },
            { kind: "set", key: "company", value: "" },
            { kind: "notify", text: "Contact saved" },
          ],
        },
        { kind: "divider" },
        { kind: "list", bindKey: "contacts", itemTemplate: "● {{item}}", emptyText: "no contacts yet" },
        {
          kind: "button",
          label: "AI draft cold email",
          variant: "ghost",
          actions: [
            { kind: "agent", promptTemplate: "Write a cold email to: {{contacts}}", saveAs: "_aiDraft" },
          ],
        },
      ],
    },
  },

  {
    id: "chat-room",
    name: "Chat Room",
    icon: "MessageCircle",
    width: 520,
    height: 520,
    initialState: { msg: "", messages: ["★ DelOS chat — message history is local"] },
    root: {
      kind: "col",
      gap: 3,
      children: [
        { kind: "text", value: "Chat Room", size: "h2" },
        { kind: "list", bindKey: "messages", itemTemplate: "{{item}}", emptyText: "no messages" },
        { kind: "divider" },
        {
          kind: "row",
          gap: 2,
          children: [
            { kind: "input", bind: "msg", placeholder: "say something…" },
            {
              kind: "button",
              label: "send",
              variant: "primary",
              actions: [
                { kind: "push", listKey: "messages", valueTemplate: "you · {{msg}}" },
                { kind: "agent", promptTemplate: "Reply briefly to: {{msg}}", saveAs: "_reply" },
                { kind: "push", listKey: "messages", valueTemplate: "agent · {{_reply}}" },
                { kind: "set", key: "msg", value: "" },
              ],
            },
          ],
        },
        {
          kind: "button",
          label: "clear chat",
          variant: "ghost",
          actions: [{ kind: "clear", key: "messages" }],
        },
      ],
    },
  },

  {
    id: "pomodoro",
    name: "Pomodoro Timer",
    icon: "Timer",
    width: 360,
    height: 420,
    initialState: { sessions: 0, mode: "work", lastNote: "" },
    root: {
      kind: "col",
      gap: 3,
      children: [
        { kind: "text", value: "Pomodoro Timer", size: "h2" },
        { kind: "text", value: "Mode: {{mode}} · Sessions: {{sessions}}", size: "h3" },
        { kind: "divider" },
        {
          kind: "row",
          gap: 2,
          children: [
            {
              kind: "button",
              label: "▶ Start 25min work",
              variant: "primary",
              actions: [
                { kind: "set", key: "mode", value: "work" },
                { kind: "tool", tool: "wait", argsTemplate: { ms: "1500000" } },
                { kind: "inc", key: "sessions", by: 1 },
                { kind: "notify", text: "Work session done — take 5min break" },
              ],
            },
            {
              kind: "button",
              label: "☕ 5min break",
              variant: "success",
              actions: [
                { kind: "set", key: "mode", value: "break" },
                { kind: "tool", tool: "wait", argsTemplate: { ms: "300000" } },
                { kind: "notify", text: "Break over — back to work" },
              ],
            },
          ],
        },
        {
          kind: "button",
          label: "Reset",
          variant: "danger",
          actions: [
            { kind: "set", key: "sessions", value: "0" },
            { kind: "set", key: "mode", value: "work" },
          ],
        },
      ],
    },
  },

  {
    id: "tip-calc",
    name: "Tip Calculator",
    icon: "Calculator",
    width: 380,
    height: 380,
    initialState: { bill: "0", tipPct: "18", people: "1", result: "" },
    root: {
      kind: "col",
      gap: 3,
      children: [
        { kind: "text", value: "Tip Calculator", size: "h2" },
        { kind: "input", bind: "bill", type: "number", placeholder: "bill $" },
        { kind: "input", bind: "tipPct", type: "number", placeholder: "tip %" },
        { kind: "input", bind: "people", type: "number", placeholder: "people" },
        {
          kind: "button",
          label: "Calculate",
          variant: "primary",
          actions: [
            { kind: "tool", tool: "calc", argsTemplate: { expr: "({{bill}} * (1 + {{tipPct}}/100)) / {{people}}" }, saveAs: "result" },
          ],
        },
        { kind: "divider" },
        { kind: "text", value: "Per person: ${{result}}", size: "h3", if: "result" },
      ],
    },
  },

  {
    // Honest naming — AppSpec runtime has no setInterval primitive yet, so
    // calling this "Stopwatch" misleads users. Renamed to "Tick Counter"
    // with explicit "manual" copy until real interval support lands.
    id: "stopwatch",
    name: "Tick Counter",
    icon: "Clock",
    width: 340,
    height: 320,
    initialState: { elapsed: 0, running: "no", laps: [] },
    root: {
      kind: "col",
      gap: 3,
      children: [
        { kind: "text", value: "Tick Counter (manual)", size: "h2" },
        { kind: "text", value: "{{elapsed}} ticks", size: "h3" },
        {
          kind: "row",
          gap: 2,
          children: [
            {
              kind: "button",
              label: "tick +1s",
              variant: "primary",
              actions: [{ kind: "inc", key: "elapsed", by: 1 }],
            },
            {
              kind: "button",
              label: "lap",
              variant: "ghost",
              actions: [{ kind: "push", listKey: "laps", valueTemplate: "lap @ {{elapsed}}s" }],
            },
            {
              kind: "button",
              label: "reset",
              variant: "danger",
              actions: [
                { kind: "set", key: "elapsed", value: "0" },
                { kind: "clear", key: "laps" },
              ],
            },
          ],
        },
        { kind: "divider" },
        { kind: "list", bindKey: "laps", itemTemplate: "{{item}}", emptyText: "no laps" },
      ],
    },
  },

  {
    id: "poll-booth",
    name: "Poll Booth",
    icon: "BarChartHorizontal",
    width: 460,
    height: 460,
    initialState: { question: "favorite agent role?", votes_planner: 0, votes_executor: 0, votes_critic: 0 },
    root: {
      kind: "col",
      gap: 3,
      children: [
        { kind: "text", value: "Poll Booth", size: "h2" },
        { kind: "input", bind: "question", placeholder: "your poll question" },
        { kind: "text", value: "Q: {{question}}", size: "body" },
        { kind: "divider" },
        {
          kind: "row",
          gap: 2,
          children: [
            { kind: "button", label: "Planner ({{votes_planner}})", variant: "primary", actions: [{ kind: "inc", key: "votes_planner", by: 1 }] },
            { kind: "button", label: "Executor ({{votes_executor}})", variant: "success", actions: [{ kind: "inc", key: "votes_executor", by: 1 }] },
            { kind: "button", label: "Critic ({{votes_critic}})", variant: "ghost", actions: [{ kind: "inc", key: "votes_critic", by: 1 }] },
          ],
        },
        {
          kind: "button",
          label: "Reset votes",
          variant: "danger",
          actions: [
            { kind: "set", key: "votes_planner", value: "0" },
            { kind: "set", key: "votes_executor", value: "0" },
            { kind: "set", key: "votes_critic", value: "0" },
          ],
        },
      ],
    },
  },

  {
    id: "weather-widget",
    name: "Weather Widget",
    icon: "Cloud",
    width: 420,
    height: 360,
    initialState: { city: "Tokyo", weather: "" },
    root: {
      kind: "col",
      gap: 3,
      children: [
        { kind: "text", value: "Weather Widget", size: "h2" },
        { kind: "input", bind: "city", placeholder: "city name" },
        {
          kind: "button",
          label: "fetch via agent",
          variant: "primary",
          actions: [
            { kind: "agent", promptTemplate: "Current weather conditions in {{city}}. Reply in one short sentence.", saveAs: "weather" },
          ],
        },
        { kind: "divider" },
        { kind: "text", value: "{{weather}}", size: "body", if: "weather" },
      ],
    },
  },

  {
    id: "notes-lite",
    name: "Notes Lite",
    icon: "StickyNote",
    width: 460,
    height: 460,
    initialState: { newNote: "", notes: [] },
    root: {
      kind: "col",
      gap: 3,
      children: [
        { kind: "text", value: "Notes Lite", size: "h2" },
        { kind: "input", bind: "newNote", placeholder: "type a note…" },
        {
          kind: "row",
          gap: 2,
          children: [
            {
              kind: "button",
              label: "+ Save",
              variant: "primary",
              actions: [
                { kind: "push", listKey: "notes", valueTemplate: "{{newNote}}" },
                { kind: "set", key: "newNote", value: "" },
                { kind: "tool", tool: "notes_append", argsTemplate: { text: "{{newNote}}" } },
              ],
            },
            {
              kind: "button",
              label: "Clear all",
              variant: "danger",
              actions: [{ kind: "clear", key: "notes" }],
            },
          ],
        },
        { kind: "divider" },
        { kind: "list", bindKey: "notes", itemTemplate: "• {{item}}", emptyText: "no notes yet" },
      ],
    },
  },
];

export function getBuiltinApp(id: string): AppSpec | undefined {
  return BUILTIN_APPS.find((a) => a.id === id);
}

export function listBuiltinApps(): Array<{ id: string; name: string; icon: string }> {
  return BUILTIN_APPS.map(({ id, name, icon }) => ({ id, name, icon }));
}
