# DelOS — environment setup

Copy `.env.example` to `.env.local` and fill in the keys below. Each provider has a free or trial tier sufficient for the demo.

## Required keys

| Provider | Env var | Where to get it |
|----------|---------|-----------------|
| Groq (planner + executor) | `GROQ_API_KEY` | https://console.groq.com → API keys |
| Mistral (judge + verifier) | `MISTRAL_API_KEY` | https://console.mistral.ai → API |
| Google AI Studio (Gemini) | `GOOGLE_GENERATIVE_AI_API_KEY` | https://ai.google.dev → Create API key |
| HydraDB (memory) | `HYDRA_DB_API_KEY` | https://hydradb.com dashboard → API |
| Cerebras (optional fast first-hop) | `CEREBRAS_API_KEY` | https://inference.cerebras.ai |

## Optional keys (graceful degradation if missing)

| Provider | Env var | Behavior without |
|----------|---------|------------------|
| ElevenLabs TTS | `ELEVENLABS_API_KEY` | Falls back to browser SpeechSynthesis |
| Gmail OAuth | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | Gmail skills disabled |
| Notion OAuth | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` | Notion skills disabled |
| GitHub OAuth | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub skills disabled |
| OpenRouter | `OPENROUTER_API_KEY` | Skipped in provider cascade |
| Together | `TOGETHER_API_KEY` | Skipped in provider cascade |

## Tenant / session

| Env var | Purpose |
|---------|---------|
| `DELRIO_TENANT_ID` | Default tenant for anonymous sessions (e.g. `delos_guest`) |
| `JWT_SECRET` | Signing key for the magic-link auth cookies (≥ 32 chars) |

## Quick start

```bash
cp .env.example .env.local
# fill in keys above
pnpm install
pnpm dev
```

Open http://localhost:3000 then click `★ DelOS` in the top right.

## Smoke test the deploy

```bash
node scripts/judge-regression.mjs http://localhost:3000
# expected: "✓ ALL CHECKS PASSED"
```

Against a Vercel preview deployment:

```bash
node scripts/judge-regression.mjs https://delrio.vercel.app
```

## Vercel deploy

1. `vercel link` to attach the local repo to the Vercel project.
2. In the Vercel dashboard, set the same env vars under Settings → Environment Variables for Production AND Preview.
3. Push to `main` — Vercel auto-deploys. Regression script reruns in CI against the preview URL.

## OAuth callback URLs

When creating each OAuth app, set the callback to:

- Gmail / GDrive: `https://<your-deploy>/api/connectors/gmail/callback`
- Notion: `https://<your-deploy>/api/connectors/notion/callback`
- GitHub: `https://<your-deploy>/api/connectors/github/callback` (when added)
- Google magic-link auth: `https://<your-deploy>/api/auth/oauth/google/callback`
- Microsoft magic-link auth: `https://<your-deploy>/api/auth/oauth/microsoft/callback`

For local development, swap the host for `http://localhost:3000`.

## Skill risk tiers

Skills route through `app/skills/page.tsx` policy:

- **READ / REVERSIBLE** (gmail search, gmail draft, notion search, notion create-page, gdrive list) → no approval tap
- **EXTERNAL / MONEY / DESTRUCTIVE** (gmail send, github create-repo, github commit-files, any wire transfer) → approval modal before fire

This policy is enforced server-side in the connector routes. Voice and assistant flows both go through the same gate.
