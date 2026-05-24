// Service worker — DelOS Chrome companion v2.2.
//
// Responsibilities:
//   1. Open the side panel on toolbar click and via context menu.
//   2. Sync tenant / model / MCP config from the main app's content script.
//   3. Provide a small RPC surface the side panel calls to act on the
//      current tab on the user's behalf — read text, click an element,
//      fill a form field, scroll, scrape links, summarize. This is what
//      makes the voice agent "autonomous": the side panel hears the
//      user's command, classifies the intent server-side, then asks us
//      to apply the action to whatever tab is in front.
//
// All tab actions use chrome.scripting.executeScript so they inherit the
// activeTab permission grant — no broad host permissions are requested.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: "delrio-run-selection",
      title: 'Run DelOS mission on "%s"',
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "delrio-open-panel",
      title: "Open DelOS side panel",
      contexts: ["page"],
    });
  } catch (e) {
    // Already created
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "delrio-run-selection" && info.selectionText && tab?.id) {
    await chrome.storage.local.set({ pendingGoal: info.selectionText.trim().slice(0, 800) });
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch {}
  }
  if (info.menuItemId === "delrio-open-panel" && tab?.id) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch {}
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────
async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return t;
}

async function runInTab(tabId, fn, args = []) {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: fn,
    args,
  });
  return res?.[0]?.result;
}

// ── Per-action page scripts (run in the visited tab's context) ──────────

/** Pull text + title + selection + meta from the current tab. */
function pageReadFn() {
  const sel = window.getSelection()?.toString() ?? "";
  const text = sel || (document.body?.innerText ?? "").slice(0, 8000);
  return {
    url: location.href,
    title: document.title,
    text,
    selection: sel,
    meta: {
      description: document.querySelector('meta[name="description"]')?.content ?? "",
      lang: document.documentElement.lang || "",
    },
  };
}

/** Find a clickable element by visible text (case-insensitive substring)
 *  and click it. Tries common interactive selectors first. */
function pageClickFn(needle) {
  if (!needle) return { ok: false, error: "empty needle" };
  const want = String(needle).trim().toLowerCase();
  const tries = [
    "button",
    "a[href]",
    "[role=button]",
    "[role=link]",
    "input[type=button]",
    "input[type=submit]",
    "summary",
  ];
  for (const sel of tries) {
    const els = Array.from(document.querySelectorAll(sel));
    for (const el of els) {
      const label =
        (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "")
          .trim()
          .toLowerCase();
      if (label && (label === want || label.includes(want))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        el.scrollIntoView({ block: "center", behavior: "instant" });
        el.click();
        return { ok: true, clicked: label.slice(0, 80) };
      }
    }
  }
  return { ok: false, error: `no clickable element matching "${needle}"` };
}

/** Fill a form input by label / placeholder / name / aria. */
function pageFillFn(field, value) {
  if (!field) return { ok: false, error: "empty field" };
  const want = String(field).trim().toLowerCase();
  const setVal = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, v) : (el.value = v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const candidates = Array.from(
    document.querySelectorAll("input, textarea, [contenteditable=true]"),
  );
  for (const el of candidates) {
    const labels = [
      el.getAttribute("aria-label"),
      el.placeholder,
      el.name,
      el.id,
      document.querySelector(`label[for="${el.id}"]`)?.innerText,
    ]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
    if (labels.some((l) => l === want || l.includes(want))) {
      el.focus();
      if (el.isContentEditable) el.innerText = String(value);
      else setVal(el, String(value));
      return { ok: true, filled: labels[0] };
    }
  }
  return { ok: false, error: `no input matching "${field}"` };
}

/** Smooth-scroll the tab. direction = up/down/top/bottom, amount in px. */
function pageScrollFn(direction = "down", amount = 800) {
  const win = window;
  if (direction === "top") win.scrollTo({ top: 0, behavior: "smooth" });
  else if (direction === "bottom") win.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  else if (direction === "up") win.scrollBy({ top: -amount, behavior: "smooth" });
  else win.scrollBy({ top: amount, behavior: "smooth" });
  return { ok: true, y: win.scrollY };
}

/** Pull the top N visible links for quick "open the first result" actions. */
function pageLinksFn(limit = 20) {
  const out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const r = a.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const text = (a.innerText || a.title || "").trim().slice(0, 120);
    if (!text) continue;
    out.push({ text, href: a.href });
    if (out.length >= limit) break;
  }
  return out;
}

// ── Message router ──────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Content script may push tenant/model sync from the main app
  if (msg?.kind === "delrio-sync") {
    const payload = msg.payload || {};
    const updates = {};
    if (typeof payload.tenantId === "string") updates.tenantId = payload.tenantId;
    if (payload.modelOverrides) updates.modelOverrides = payload.modelOverrides;
    if (payload.mcpServers) updates.mcpServers = payload.mcpServers;
    if (Object.keys(updates).length) {
      chrome.storage.local
        .set(updates)
        .then(() => sendResponse({ ok: true }));
      return true;
    }
  }

  // Legacy alias kept for old side panel builds.
  if (msg?.kind === "delrio-grab-tab") {
    activeTab().then((t) => {
      if (!t?.id) {
        sendResponse({ error: "no active tab" });
        return;
      }
      runInTab(t.id, pageReadFn)
        .then((data) => sendResponse({ data }))
        .catch((e) => sendResponse({ error: String(e) }));
    });
    return true;
  }

  // Unified tab-action RPC. Used by the autonomous voice loop.
  if (msg?.kind === "delos-tab-action") {
    (async () => {
      const t = await activeTab();
      if (!t?.id) return sendResponse({ ok: false, error: "no active tab" });

      const { action, args = {} } = msg;
      try {
        switch (action) {
          case "read":
            sendResponse({ ok: true, data: await runInTab(t.id, pageReadFn) });
            break;
          case "click":
            sendResponse({ ok: true, data: await runInTab(t.id, pageClickFn, [args.needle]) });
            break;
          case "fill":
            sendResponse({
              ok: true,
              data: await runInTab(t.id, pageFillFn, [args.field, args.value]),
            });
            break;
          case "scroll":
            sendResponse({
              ok: true,
              data: await runInTab(t.id, pageScrollFn, [args.direction || "down", args.amount || 800]),
            });
            break;
          case "links":
            sendResponse({ ok: true, data: await runInTab(t.id, pageLinksFn, [args.limit || 20]) });
            break;
          case "navigate": {
            // Normalize bare names → DuckDuckGo or known shortcuts so the user
            // can say "open github" and land on github.com without typing.
            const u = normalizeUrl(args.url || args.query || "");
            if (!u) return sendResponse({ ok: false, error: "could not resolve URL" });
            await chrome.tabs.update(t.id, { url: u });
            sendResponse({ ok: true, data: { url: u } });
            break;
          }
          case "open_tab": {
            const u = normalizeUrl(args.url || args.query || "");
            if (!u) return sendResponse({ ok: false, error: "could not resolve URL" });
            const created = await chrome.tabs.create({ url: u });
            sendResponse({ ok: true, data: { url: u, tabId: created.id } });
            break;
          }
          case "close_tab":
            if (t.id) await chrome.tabs.remove(t.id);
            sendResponse({ ok: true });
            break;
          case "reload":
            await chrome.tabs.reload(t.id);
            sendResponse({ ok: true });
            break;
          case "back":
            await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => history.back() });
            sendResponse({ ok: true });
            break;
          case "forward":
            await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => history.forward() });
            sendResponse({ ok: true });
            break;
          default:
            sendResponse({ ok: false, error: `unknown action: ${action}` });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }
});

// Resolve "github" / "open github" → https://github.com
// Bare hostnames pass through. Unknown words → DuckDuckGo lite search so
// the agent always lands somewhere useful.
function normalizeUrl(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  // Strip "open " / "go to " prefixes the LLM tends to leak in payloads.
  s = s.replace(/^(open|go to|navigate to|visit)\s+/i, "");
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+\.[\w.-]+/.test(s)) return "https://" + s;
  const KNOWN = {
    github: "https://github.com",
    google: "https://www.google.com",
    youtube: "https://www.youtube.com",
    twitter: "https://twitter.com",
    x: "https://twitter.com",
    reddit: "https://www.reddit.com",
    chatgpt: "https://chat.openai.com",
    claude: "https://claude.ai",
    notion: "https://www.notion.so",
    delos: "https://delrio.vercel.app",
    gmail: "https://mail.google.com",
    drive: "https://drive.google.com",
    calendar: "https://calendar.google.com",
    hackernews: "https://news.ycombinator.com",
    hn: "https://news.ycombinator.com",
  };
  const key = s.toLowerCase().replace(/\s+/g, "");
  if (KNOWN[key]) return KNOWN[key];
  // Fall back to a DuckDuckGo search so voice agent never dead-ends.
  return "https://duckduckgo.com/?q=" + encodeURIComponent(s);
}
