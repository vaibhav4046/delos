// One shot screenshot capture for the README.
//
// Usage:
//   npx playwright install chromium    # first run only
//   node scripts/capture-screenshots.mjs
//
// Captures six PNGs into docs/screenshots/ at 1440x900. README already
// references the matching paths so the GitHub front page renders the
// shots inline after the next push.
//
// Why a script · CSP blocks html2canvas via CDN. Native Playwright
// hits the live deploy and saves the actual visible viewport.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "docs", "screenshots");
const base = process.env.BASE_URL || "https://delrio.vercel.app";

const shots = [
  {
    file: "os-desktop.png",
    url: `${base}/os?guest=1`,
    settle: 9000,
    note: "first boot · dock + counter strip + welcome",
  },
  {
    file: "os-judge-demo.png",
    url: `${base}/os?guest=1&demo=judge`,
    settle: 14000,
    note: "narration card mid run · step 2 or 3",
  },
  {
    file: "memory-app.png",
    url: `${base}/os?guest=1`,
    settle: 8000,
    action: async (page) => {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "memoryBrowser" } })));
      await page.waitForTimeout(4000);
    },
    note: "memory browser with seed entries plus source badges",
  },
  {
    file: "vibecode.png",
    url: `${base}/os?guest=1`,
    settle: 6000,
    action: async (page) => {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("delos-launch-app", { detail: { id: "builder" } })));
      await page.waitForTimeout(2000);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("delos-intent", { detail: { kind: "builder.build", prompt: "Build a Regulatory AML cockpit with alert queue, SAR draft, audit log" } })));
      await page.waitForTimeout(7000);
    },
    note: "vibecode + delcode panel streaming files",
  },
  {
    file: "arena.png",
    url: `${base}/arena`,
    settle: 5000,
    action: async (page) => {
      const button = page.locator("button:has-text('START RACE')");
      if (await button.count()) await button.first().click().catch(() => {});
      await page.waitForTimeout(12000);
    },
    note: "five model race in progress",
  },
  {
    file: "landing.png",
    url: `${base}/`,
    settle: 6000,
    note: "marketing hero with cohort race animation",
  },
];

async function run() {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const shot of shots) {
    console.log(`→ ${shot.file} · ${shot.url}`);
    await page.goto(shot.url, { waitUntil: "load" });
    await page.waitForTimeout(shot.settle);
    if (shot.action) await shot.action(page);
    const path = join(out, shot.file);
    await page.screenshot({ path, fullPage: false });
    console.log(`  saved ${path}`);
  }
  await browser.close();
  console.log("\nDone. Run:");
  console.log("  git add docs/screenshots && git commit -m 'docs · real screenshots' && git push");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
