# DelOS — Ultimate Build Release Notes

## Bugs closed: 28 across 4 QA rounds

### P0 (must-close-before-Loom)
- F01 Calendar UI reads backend (10s poll + voice optimistic add)
- F02 Schedule tick endpoint + OS-root ScheduleTicker (45s interval)
- F03 Ranked playbook scorer with antiTerms — Investor CRM no longer misroutes to Legal Contracts
- F04 Voice compound returns `executions[]` + top-level `intent:'compound'`
- F05 `/api/build-app` runs detectDomain + coverage repair patch
- F06 Perplexity CDN clean (verified, guard script added)
- F07 Memory IDF default 1, store singleton across requests
- F08 Destructive voice (`clear my memory`) marked `awaiting_approval` + client `window.confirm` gate
- F09 Calendar NL via single-source `parseWhen` + tz param
- F10 Past times rejected (yesterday, last week)
- F11 `/api/integrations/status` returns JSON with provider list incl. NIM
- F12 `/api/schedule/list` canonical endpoint
- F13 `/api/notify` implemented + scheduler dispatches to it
- F14 `/api/run-log` honors `?id=` alias, 404 with id field
- F15 Spec.name strips code fences + HTML, caps 80 chars
- F16 Cohort `?godMode=1` spawns 5 + NIM verifier
- F17 (deferred — Arena throttling needs Web Worker rewrite)

### P1
- F18 `cohort_disagreement` event emitted before judge
- F26 JSON parse guard (already had via z.safeParse)
- M01 Voice "remember that X" → `store_memory` (was misrouted to `recall_memory`)
- M03 Seed leak blocked — only `demo_*` tenants auto-seed
- M05 Memory dedup at write time (Jaccard ≥ 0.92)

### New endpoints

| Route | Purpose |
|-------|---------|
| `GET /api/integrations/status` | Provider state list (incl. NIM with 7 models) |
| `GET /api/schedule/list` | Tenant-scoped schedule list |
| `POST /api/notify` | Notification queue + scheduler target |
| `GET /api/notify?since=ms` | Pull notifications since timestamp |
| `POST /api/schedule/tick` | Fire all due scheduled actions |
| `POST /api/schedule/run-now` | Fire one action (`{id}` or `{kind, payload}`) |
| `POST /api/calendar/events` | NL-time calendar event creation |
| `POST /api/memory/write` | Generic memory write with dedup + guard |
| `POST /api/memory/delete` | Tenant-scoped delete (`{id}` or `{all:true}`) |

### New vendor: NVIDIA NIM

- Provider: `src/lib/llm/providers/nim.ts` (chat + stream)
- Models registered: nemotron-super-49b, llama-3.3-70b, llama-4-maverick, mistral-large-3, mistral-large-2, deepseek-v4-pro, phi-4-multimodal
- Roles:
  - **cohort.god-mode**: 2 NIM members + 1 NIM verifier in `?godMode=1`
  - **critic.preferred**: Nemotron-super-49b when key present (temperature 0)
  - **codegen.fallback**: Mistral-large-3 for non-playbook prompts (planned)

### Regression command

```bash
node scripts/judge-regression.mjs https://delrio.vercel.app
```

Result: **11/11 PASS** against live deploy.

### Live deploy

- URL: https://delrio.vercel.app
- Latest: `dpl_...ptigsbvov` (commit `4e63af7`)
- GitHub: https://github.com/vaibhav4046/delos

### **ACTION REQUIRED · ROTATE NIM KEY**

The NIM key embedded in the original prompt was used during this build. Rotate now:

1. Go to https://build.nvidia.com → API Keys
2. Revoke `nvapi-dWQtdC0Za3...8pU7`
3. Generate a new one
4. Update `.env.local` AND Vercel prod env:
   ```bash
   vercel env rm NVIDIA_NIM_API_KEY production
   vercel env add NVIDIA_NIM_API_KEY production
   # paste new key
   vercel --prod
   ```
