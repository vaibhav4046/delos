# DelOS — Deploy to Vercel + push to GitHub

This document is the operator-side runbook. I (Claude) cannot push to your GitHub or deploy to your Vercel account directly — those operations require your credentials. Follow these steps in order; total time ~10 minutes.

## Prerequisites (one-time)

```bash
# Confirm Node version (20+ required)
node -v

# Install Vercel CLI globally
npm i -g vercel

# Install GitHub CLI (optional but faster than the web UI)
# macOS: brew install gh
# Windows: winget install GitHub.cli
# Linux: https://github.com/cli/cli/blob/trunk/docs/install_linux.md
gh auth login
```

## Step 1 — GitHub repo push

```bash
cd "C:\Users\lalwa\OneDrive\Desktop\claude max work\delrio"

# If you haven't initialized git yet:
git init
git add .
git commit -m "DelOS — hackathon-ready build"

# Create the public GitHub repo and push in one shot via gh CLI:
gh repo create delos --public --source=. --remote=origin --push --description "Browser OS where AI agents survive real-world chaos"

# OR if you already have a repo, just push:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

After push, verify:

```bash
gh repo view --web      # opens the repo in your browser
```

## Step 2 — Vercel project link + deploy

```bash
# From the repo root:
vercel link

# Walk through the prompts:
# - Scope: pick your personal scope
# - Project name: delos (or whatever you want)
# - Modify settings: No (defaults are correct)

# First production deploy:
vercel --prod
```

Vercel will print your live URL when it finishes (~90 seconds). Example:

```
✅  Production: https://delos-yourname.vercel.app [60s]
```

That URL is your hackathon submission link. Copy it.

## Step 3 — Set env vars in Vercel

```bash
# Required vars — paste your real keys when prompted:
vercel env add GROQ_API_KEY production
vercel env add MISTRAL_API_KEY production
vercel env add GOOGLE_GENERATIVE_AI_API_KEY production
vercel env add HYDRA_DB_API_KEY production
vercel env add JWT_SECRET production
vercel env add DELRIO_TENANT_ID production

# Optional vars (graceful degradation if missing):
vercel env add ELEVENLABS_API_KEY production
vercel env add CEREBRAS_API_KEY production
vercel env add DEEPSEEK_API_KEY production
vercel env add OPENROUTER_API_KEY production
vercel env add TOGETHER_API_KEY production

# Connector OAuth (if you want Gmail/Notion/GitHub/GDrive skills):
vercel env add GMAIL_CLIENT_ID production
vercel env add GMAIL_CLIENT_SECRET production
vercel env add NOTION_CLIENT_ID production
vercel env add NOTION_CLIENT_SECRET production

# Re-deploy to pick up the new env vars:
vercel --prod
```

Where to get each key — see `outputs/SETUP.md`.

## Step 4 — Run the regression against the live URL

```bash
node scripts/judge-regression.mjs https://your-vercel-url.vercel.app
```

Expected output: `✓ ALL CHECKS PASSED (11 pass, 0 skip)`.

If any check fails, the output names which one. Fix locally, push to GitHub, Vercel auto-deploys the fix, re-run the regression.

## Step 5 — Update README with the live URL

Open `README.md` and replace `https://delrio.vercel.app` with your actual deploy URL (only if different). Push:

```bash
git add README.md
git commit -m "Update live URL"
git push
```

## Step 6 — Wire CI to GitHub (optional)

The `.github/workflows/ci.yml` file runs typecheck, lint, build, and regression on every push. To enable the regression step against your preview deploy, add a repo secret:

```bash
gh secret set JUDGE_REGRESSION_URL --body "https://your-vercel-url.vercel.app"

# And for the build step's stub env vars (so it doesn't ship to a real provider):
gh secret set GROQ_API_KEY --body "ci-build-stub"
gh secret set MISTRAL_API_KEY --body "ci-build-stub"
gh secret set GOOGLE_GENERATIVE_AI_API_KEY --body "ci-build-stub"
gh secret set HYDRA_DB_API_KEY --body "ci-build-stub"
gh secret set JWT_SECRET --body "ci-stub-secret-thirty-two-chars-min"
```

CI will now run green on every push.

## Step 7 — Take screenshots for the README

```bash
# Boot the prod build locally:
npm run build
npm start &

# Use any browser to navigate and screenshot manually, or Playwright:
npx playwright install chromium

# Save screenshots into docs/SCREENSHOTS/
# Recommended shots:
# - os-shell.png         (the DelOS desktop with a window open)
# - memory-browser.png   (with seeded memories)
# - vibecode-investor.png (the materialized Investor CRM)
# - cohort-race.png      (3-5 models racing)
# - chaos-demo.png       (chaos toggle on, sibling fallback in trace)

# Optional · automated screenshot capture (separate script you can write):
# node scripts/build-screenshots.mjs http://localhost:3000

# Then commit:
git add docs/SCREENSHOTS/*.png
git commit -m "docs: add screenshots"
git push
```

## Step 8 — Record the Loom demo

Follow `outputs/LOOM_SCRIPT.md` beat-by-beat. Upload to Loom (or YouTube unlisted as backup). Paste the Loom URL into `outputs/HACKATHON_FORM.md` under "Demo video URL".

## Step 9 — Submit the hackathon form

Open `outputs/HACKATHON_FORM.md`. Copy each section into the corresponding form field on the hackathon platform. Do NOT auto-submit — paste manually, then click submit yourself.

## Troubleshooting

**Vercel build fails on env validation:**
The build runs `src/lib/env.ts` which checks for required keys. If a key is missing in Vercel, add it via `vercel env add ...` and re-deploy.

**Vercel function timeout (10s):**
Already configured: `/api/codegen-app-stream` has `maxDuration = 90`. `/api/run` streams forever (no maxDuration cap).

**HydraDB tenant not found:**
HydraDB tenants are auto-created on first write via `ensureTenant`. First request to a new tenant may add ~200ms latency.

**Regression check fails on prod but passes local:**
Usually a missing env var in Vercel. Compare your local `.env.local` against `vercel env ls`.

**Domain detection misses your prompt:**
Edit the `triggers` regex in `src/lib/codegenPlaybooks.ts` for that domain. Tighter triggers = fewer false positives; looser = better catch rate.

## Final sanity check before submitting

- [ ] Live URL responds in < 2s on first paint
- [ ] `node scripts/judge-regression.mjs <URL>` prints `ALL CHECKS PASSED`
- [ ] README has the live URL and the Loom URL
- [ ] `outputs/HACKATHON_FORM.md` is fully filled
- [ ] GitHub repo is public and `gh repo view --web` opens cleanly
- [ ] Screenshots committed under `docs/SCREENSHOTS/`
- [ ] Loom video unlisted-but-accessible and under 5 minutes
- [ ] `.env.local` is in `.gitignore` (verify with `git ls-files .env.local` returning nothing)

You are ready to submit.
