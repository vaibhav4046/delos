# DelOS — Schema reference

## HydraDB collections

DelOS uses one HydraDB tenant per user (or per reserved prefix for QA / demo / judge / hack / test scopes). Within a tenant, memories are stored as graph nodes with vector embeddings.

### Memory node

```ts
type StoredMemory = {
  id: string;          // "mem-<ts>-<rand>"
  runId: string;       // run that produced this memory, or "unknown" / "seed-*"
  tenantId: string;    // resolved tenant
  text: string;        // sanitized memory text (XSS-defanged)
  tags: string[];      // canonical lowercase tags, max 16, max 40 chars each
  createdAt: number;   // unix ms
}
```

### Tag namespaces

| Namespace | Use |
|-----------|-----|
| `pinned` | Pinned by the user via `/api/memory/pin` |
| `user-fact` | Structured fact: `User fact · key = value` |
| `run-summary` | One-line agent run summary |
| `app-build` | App was materialized via `/api/build-app` |
| `app-spec` | Compiled DelOS AppSpec |
| `chaos-recovery` | Run survived a chaos toggle |
| `cohort` | Cohort race result |
| `learning` | Cross-run heuristic, e.g. routing hint |
| `preference` | User preference, cross-session |
| `recall-meta` | Memory about memory (debugging artifact) |
| `voice-autonomy` | Voice command outcome |
| `tool-fallback` | Sibling fallback fired |
| `domain-playbook` | Codegen used a playbook |
| `seeded` | Demo seed entry |

Reserved tags rejected by `sanitizeTags`: `__proto__`, `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`.

### Tenant resolution

Tenants resolve in this order:

1. Signed session cookie (via `getServerSession` from magic-link auth).
2. Reserved-prefix body / header / query (`tenant=qa_...`, `demo_...`, `test_...`, `judge_...`, `hack_...`).
3. Anon IP-scoped tenant: `anon_<sha256(IP)[:12]>`.
4. Fallback: `DELRIO_TENANT_ID` env var.

Reserved prefix regex: `/^(qa|test|demo|judge|hack)_[\w-]+$/`.

## App-build spec

`/api/build-app` returns a constrained DSL spec:

```ts
type AppSpec = {
  id: string;            // slug
  name: string;          // human title (sanitized via sanitizeTitle, 60 char cap)
  description: string;
  theme: { bg, fg, accent, ... };
  components: Array<{
    id: string;
    kind: "button" | "input" | "text" | "list" | "card" | "image" | "chart" | ...;
    label?: string;
    state?: Record<string, unknown>;
    handlers?: Record<string, Action>;
    children?: Component[];
  }>;
  state: Record<string, unknown>;
  effects?: Effect[];
};
```

Spec apps mount as DelOS windows. State persists per tenant in HydraDB if the app declares `persistKey`.

## Codegen project

`/api/codegen-app` and `/api/codegen-app-stream` return a full file tree:

```ts
type CodegenProject = {
  name: string;
  description: string;
  stack: string;
  files: Array<{
    path: string;        // e.g. "app/page.tsx"
    content: string;     // up to 20KB per file
    language: "typescript" | "javascript" | "tsx" | "jsx" | "css" | "json" | "markdown" | "html" | "text";
  }>;
  runInstructions?: string;
  notes?: string[];
};
```

Stream events:

```
plan_start    { prompt, tier, uiStyle, at }
plan_done     { project: { name, description, stack, files: [{path, purpose}] }, playbook?, deterministic? }
file_start    { path, index, total }
file_chunk    { path, chunk }       (LLM path only)
file_done     { path, content, language, index, total }
file_skip     { path, reason, index, total }
project_done  { project, coverage?, deterministic?, ms, at }
error         { message, code }
```

For matched-playbook paths: `deterministic: true`, no `file_chunk` events, full content arrives in one `file_done` per file, sub-3s total.

## Playbook definition

```ts
type Playbook = {
  id: DomainKey;
  name: string;
  triggers: RegExp[];
  requiredTerms: string[];      // tallied for coverage scoring
  requiredComponents: string[]; // names that must appear in file paths
  files: PlaybookFileTemplate[];
  coverageFloor: number;        // 0.85 default
};

type CoverageReport = {
  domain: DomainKey;
  score: number;             // 0..1
  matched: string[];
  missing: string[];
  threshold: number;
};
```

## Run log

`/api/run-log/[runId]` (when persisted):

```ts
type PersistedRun = {
  runId: string;
  tenantId: string;
  goal: string;
  startedAt: number;
  endedAt?: number;
  events: RunEvent[];  // see types.ts for full union
  metrics: {
    elapsedMs: number;
    tokenIn: number;
    tokenOut: number;
    costUsd: number;
    replans: number;
    toolCalls: number;
    successes: number;
  };
};
```

## Run events (truncated union)

```ts
type RunEvent =
  | { t: "meta", runId, at }
  | { t: "phase", phase: "boot"|"recall"|"plan"|"act"|"critic"|"store"|"done", note?, at }
  | { t: "thought", agent: "planner"|"executor"|"critic", text, at }
  | { t: "tool_call", name, args, at }
  | { t: "tool_result", name, ok, result, at }
  | { t: "memory_recall", query, hits, at }
  | { t: "memory_write", key, preview, at }
  | { t: "metric", key, value, at }
  | { t: "answer", text, at }
  | { t: "usage", role, model, promptTokens, completionTokens, ms, at }
  | { t: "subagent", id, goal, status: "spawn"|"done"|"error", at }
  | { t: "recover", reason, strategy, at }
  | { t: "error", message, at };
```

## API field unification

Canonical: `input`. Legacy fields accepted with `Deprecation: true` header:

| Canonical | Legacy aliases |
|-----------|----------------|
| `input` | `prompt`, `goal`, `command`, `transcript`, `text`, `query`, `instruction`, `newGoal` |

See `src/lib/apiField.ts`.

## Approval-tap risk tiers

| Tier | Examples | Approval required |
|------|----------|-------------------|
| READ | gmail.search, notion.search, gdrive.list_recent | No |
| REVERSIBLE | gmail.draft_reply (saves draft), notion.create_page, gdrive.create_doc | No |
| DRAFT | clipboard.write, pdf.write | No |
| EXTERNAL | github.create_repo, github.commit_files | Yes |
| MONEY | (stripe, plaid, etc — none shipped) | Yes |
| DESTRUCTIVE | gmail.send, github.delete_repo, file.delete | Yes |

Policy enforced in `app/skills/page.tsx` and replicated server-side in each connector route.
