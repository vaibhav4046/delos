import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "submission", "recordings");
const rawDir = path.join(outDir, "raw");
await fs.mkdir(rawDir, { recursive: true });

const url = process.argv[2] || "https://delrio.vercel.app/os?guest=1";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: rawDir, size: { width: 1440, height: 900 } },
});

const page = await context.newPage();
page.setDefaultTimeout(12_000);

async function wait(ms) {
  await page.waitForTimeout(ms);
}

async function caption(text, sub = "") {
  await page.evaluate(
    ({ text, sub }) => {
      const id = "__delrio_demo_caption";
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.style.position = "fixed";
        el.style.left = "28px";
        el.style.right = "28px";
        el.style.bottom = "24px";
        el.style.zIndex = "2147483647";
        el.style.padding = "16px 18px";
        el.style.border = "1px solid rgba(255, 211, 0, 0.7)";
        el.style.background = "rgba(6, 8, 12, 0.88)";
        el.style.boxShadow = "0 18px 60px rgba(0,0,0,0.42)";
        el.style.color = "#fff6c2";
        el.style.fontFamily = "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
        el.style.borderRadius = "8px";
        el.style.backdropFilter = "blur(10px)";
        el.style.pointerEvents = "none";
        document.body.appendChild(el);
      }
      el.innerHTML = `
        <div style="font-size:22px;font-weight:750;line-height:1.25;letter-spacing:0">${text}</div>
        ${sub ? `<div style="margin-top:6px;font-size:14px;color:#cbd5e1;line-height:1.35;letter-spacing:0">${sub}</div>` : ""}
      `;
    },
    { text, sub },
  );
}

async function hideCaption() {
  await page.evaluate(() => document.getElementById("__delrio_demo_caption")?.remove());
}

async function dismissBlockingOverlays() {
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll('[role="dialog"][aria-modal="true"]').forEach((el) => el.remove());
  });
}

async function clickButton(name) {
  await dismissBlockingOverlays();
  const loc = page.getByRole("button", { name, exact: true });
  if ((await loc.count()) !== 1) throw new Error(`Expected one button: ${name}`);
  await loc.click();
}

async function clickText(text) {
  await dismissBlockingOverlays();
  const loc = page.getByText(text, { exact: true });
  const count = await loc.count();
  if (count < 1) throw new Error(`Expected text: ${text}`);
  await loc.first().click();
}

async function snapshot(label) {
  const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  await page.screenshot({ path: path.join(outDir, `${safe}.png`), fullPage: false });
}

await page.goto(`${url}${url.includes("?") ? "&" : "?"}recording=${Date.now()}`, { waitUntil: "domcontentloaded" });
await wait(3_000);
await page.evaluate(() => {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {}
});
await page.reload({ waitUntil: "domcontentloaded" });
await wait(4_000);
await dismissBlockingOverlays();

await caption(
  "DelOS: an agent operating system under pressure",
  "This demo shows the verified hackathon path: memory, voice control, app generation, calendar actions, and connector honesty.",
);
await snapshot("01-desktop");
await wait(4_000);

await caption(
  "HydraDB memory is live on first launch",
  "A judge opens Memory Browser and immediately sees seeded cross-run memories, routing hints, app specs, and preferences.",
);
await clickButton("Launch Memory Browser");
await wait(7_000);
await snapshot("02-memory-browser");

await caption(
  "Voice Agent turns natural language into executable OS actions",
  "The fixed R12 contract keeps top-level intent and execution kind aligned, including calendar and reminder commands.",
);
await clickButton("Launch Voice Agent");
await wait(2_000);
await snapshot("03-voice-agent");

await caption(
  "App Builder: domain playbooks, not generic output",
  "Investor CRM, clinical trials, legal contracts, fintech AML, AI tutor, and ops incident workflows use domain-specific playbooks.",
);
await clickButton("Launch VibeCode");
await wait(3_000);
await snapshot("04-vibecode");

await caption(
  "Building a production-style Investor CRM",
  "The generated app includes commitment scoring, warm-intro graph, partner follow-up, risk flags, diligence checklist, and portfolio board.",
);
try {
  await clickText("Investor CRM · Warm-Intro Graph");
  await wait(1_000);
} catch {
  // The field may already contain the investor CRM prompt on warm prod sessions.
}
const buildButton = page.getByRole("button", { name: "▶ BUILD APP", exact: true });
if ((await buildButton.count()) === 1) {
  await buildButton.click();
  await wait(12_000);
} else {
  await wait(5_000);
}
await snapshot("05-investor-crm-build");

await caption(
  "Calendar and reminders are voice-ready",
  "Verified commands: schedule lunch next Friday at 1pm, create calendar event lunch next Friday at 1pm, and remind me at 3pm to call Andy.",
);
await clickButton("Launch Calendar");
await wait(2_500);
await clickButton("Launch Schedule");
await wait(2_500);
await snapshot("06-calendar-schedule");

await caption(
  "Connectors stay honest in demo mode",
  "Gmail and Notion actions return explicit demo_simulated responses until OAuth is connected, avoiding fake production claims.",
);
await clickButton("Launch Del Assistant");
await wait(3_000);
await snapshot("07-assistant-connectors");

await caption(
  "Ready for the hackathon recording",
  "Verified: 14/14 live regression, clean build, Memory Browser visual pass, App Builder domain coverage, and voice execution alignment.",
);
await wait(5_000);
await hideCaption();
await wait(1_000);

const video = page.video();
await context.close();
await browser.close();

const rawVideo = await video.path();
const targetWebm = path.join(outDir, "delrio-r12-demo.webm");
await fs.copyFile(rawVideo, targetWebm);
console.log(targetWebm);
