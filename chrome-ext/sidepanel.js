// DelOS side panel v3.1 — Mission unified browser agent.
//
// EXT-V5 · 3 tabs: Mission (browse + chat + chain), Cohort, Memory.
// Voice gone. Browse merged into Mission. chrome:// pages handled
// gracefully. Endless conversation per session.

const MODELS = [
  "groq:openai/gpt-oss-120b",
  "groq:openai/gpt-oss-20b",
  "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
  "groq:moonshotai/kimi-k2-instruct-0905",
  "mistral:mistral-large-latest",
  "google:gemini-2.5-flash",
  "nim:nvidia/llama-3.3-nemotron-super-49b-v1",
];

const DEFAULTS = {
  endpoint: "https://delrio.vercel.app",
  tenantId: "delrio_demo",
  modelOverrides: {},
  mcpServers: [],
};

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = {
  cfg: { ...DEFAULTS },
  activeTab: "mission",
  runBase: Date.now(),
  // EXT-V5-3 · endless conversation thread · {role, text, lastUrl}[]
  thread: [],
  // Last browse plan summary for chain re-plan continuity
  lastPlanSummary: "",
  // Stop flag for the current mission run
  stop: false,
};

// EXT-V5-2 · chrome://, edge://, about:, chrome-extension:// can't be scripted
// against. Return a sentinel so callers can show a friendly hint instead of
// dumping a red ERR.
function isUnscriptableUrl(url) {
  if (!url) return false;
  return /^(chrome|edge|about|chrome-extension|view-source|file|devtools):/i.test(url);
}

// ───────────────────────── storage / sync ─────────────────────────
async function loadCfg() {
  const stored = await chrome.storage.local.get([
    "endpoint",
    "tenantId",
    "modelOverrides",
    "mcpServers",
  ]);
  state.cfg.endpoint = stored.endpoint || DEFAULTS.endpoint;
  state.cfg.tenantId = stored.tenantId || DEFAULTS.tenantId;
  state.cfg.modelOverrides = stored.modelOverrides || {};
  state.cfg.mcpServers = stored.mcpServers || [];
}

async function saveCfg() {
  await chrome.storage.local.set({
    endpoint: state.cfg.endpoint,
    tenantId: state.cfg.tenantId,
    modelOverrides: state.cfg.modelOverrides,
    mcpServers: state.cfg.mcpServers,
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let changed = false;
  for (const k of ["endpoint", "tenantId", "modelOverrides", "mcpServers"]) {
    if (changes[k]) {
      state.cfg[k] = changes[k].newValue ?? state.cfg[k];
      changed = true;
    }
  }
  if (changed) {
    renderSettings();
    refreshConn();
  }
});

// ───────────────────────── connection ────────────────────────────
async function probeHealth() {
  try {
    const r = await fetch(`${state.cfg.endpoint}/api/health`, {
      method: "GET",
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function refreshConn() {
  const pill = $("#conn");
  if (!pill) return;
  pill.className = "pill pill-warn";
  pill.textContent = "● checking";
  let ok = false;
  for (let i = 0; i < 3; i++) {
    ok = await probeHealth();
    if (ok) break;
    if (i < 2) await new Promise((res) => setTimeout(res, 250 + i * 350));
  }
  if (ok) {
    pill.className = "pill pill-ok";
    pill.textContent = "● connected";
    pill.title = `connected · last checked ${new Date().toLocaleTimeString()}`;
  } else {
    pill.className = "pill pill-bad";
    pill.textContent = "● offline";
    pill.title = `health probe failed · click to retry`;
  }
}

// ───────────────────────── tabs ──────────────────────────────────
$$(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.remove("on"));
    $$(".panel").forEach((x) => x.classList.remove("on"));
    t.classList.add("on");
    $(`[data-panel="${t.dataset.tab}"]`).classList.add("on");
    state.activeTab = t.dataset.tab;
    if (t.dataset.tab === "memory") memoryRefresh();
  }),
);

// ───────────────────────── settings ──────────────────────────────
function renderSettings() {
  $("#cfgEndpoint").value = state.cfg.endpoint;
  $("#cfgTenant").value = state.cfg.tenantId || "";
  for (const role of ["planner", "executor", "critic"]) {
    const sel = $(`#cfg${role.charAt(0).toUpperCase() + role.slice(1)}`);
    sel.innerHTML =
      '<option value="">(default)</option>' +
      MODELS.map((m) => `<option value="${m}">${m}</option>`).join("");
    sel.value = state.cfg.modelOverrides[role] || "";
  }
}
$("#settingsBtn").addEventListener("click", () => $("#settingsModal").classList.remove("hidden"));
$("#settingsClose").addEventListener("click", () => $("#settingsModal").classList.add("hidden"));
$("#conn")?.addEventListener("click", () => refreshConn());
$("#cfgSave").addEventListener("click", async () => {
  state.cfg.endpoint = $("#cfgEndpoint").value.trim() || DEFAULTS.endpoint;
  state.cfg.tenantId = $("#cfgTenant").value.trim() || DEFAULTS.tenantId;
  const ov = {};
  for (const role of ["planner", "executor", "critic"]) {
    const v = $(`#cfg${role.charAt(0).toUpperCase() + role.slice(1)}`).value;
    if (v) ov[role] = v;
  }
  state.cfg.modelOverrides = ov;
  await saveCfg();
  $("#settingsModal").classList.add("hidden");
  refreshConn();
});

// ───────────────────────── render helpers ────────────────────────
function tag(cls, label) {
  return `<span class="tag ${cls}">${label}</span>`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]),
  );
}
function appendLog(targetId, html) {
  const el = $(`#${targetId}`);
  if (!el) return;
  if (el.firstChild?.classList?.contains("empty")) el.innerHTML = "";
  const div = document.createElement("div");
  div.className = "line";
  div.innerHTML = html;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

// ───────────────────────── tab action RPC ────────────────────────
function tabAction(action, args = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ kind: "delos-tab-action", action, args }, (res) =>
      resolve(res || { ok: false, error: "no response" }),
    );
  });
}

async function captureAndLog(targetId, label = "") {
  try {
    const shot = await tabAction("screenshot");
    if (!shot?.ok || !shot.data?.dataUrl) return;
    appendLog(
      targetId,
      `<div class="screenshot"><span class="muted small">📸 ${esc(label)}</span><br>` +
        `<img src="${shot.data.dataUrl}" alt="screenshot ${esc(label)}" ` +
        `style="max-width:100%;max-height:200px;border:1px solid var(--accent,#fbc531);margin-top:4px" /></div>`,
    );
  } catch {}
}

// EXT-V5-2 · safely read the active tab. Returns null with a logged hint when
// the active tab is a chrome:// / extension / file URL the agent can't touch.
async function safeReadTab(targetLog = "missionLog") {
  const r = await tabAction("read");
  if (!r?.ok) {
    const err = r?.error || "";
    if (/chrome:\/\/|edge:\/\/|cannot access/i.test(err)) {
      appendLog(targetLog, `${tag("muted", "tab")} skipped · open any regular webpage (e.g. google.com) and the agent can use it for context`);
      return null;
    }
    appendLog(targetLog, `${tag("muted", "tab")} read failed · ${esc(err)}`);
    return null;
  }
  if (isUnscriptableUrl(r.data?.url)) {
    appendLog(targetLog, `${tag("muted", "tab")} on a browser-internal page · open a real webpage to use as context`);
    return null;
  }
  return r.data;
}

// ───────────────────────── MISSION · unified agent ───────────────
$("#missionRunBtn")?.addEventListener("click", () => runMission(false));
$("#missionStopBtn")?.addEventListener("click", () => { state.stop = true; });

async function runMission(isContinuation = false, continuationContext = "") {
  const taskRaw = $("#missionTask").value.trim();
  if (!taskRaw && !isContinuation) {
    appendLog("missionLog", `${tag("bad", "ERR")} task required`);
    return;
  }
  const task = isContinuation
    ? continuationContext
    : taskRaw;
  if (!isContinuation) {
    $("#missionLog").innerHTML = "";
    state.stop = false;
    state.thread = [{ role: "user", text: taskRaw }];
    state.lastPlanSummary = "";
    appendLog("missionLog", `<b>YOU</b> ${esc(taskRaw)}`);
  }
  await tabAction("overlay_boot");
  await tabAction("banner", {
    message: isContinuation ? "re-planning" : "planning",
    subtitle: String(taskRaw || task).slice(0, 120),
    kind: "info",
    durationMs: 3500,
  });

  // Gather current tab context if user opted in and tab is scriptable.
  let tabContext = null;
  if ($("#missionUseTab")?.checked) {
    const d = await safeReadTab("missionLog");
    if (d) {
      tabContext = {
        url: String(d.url || "").slice(0, 380),
        title: String(d.title || "").slice(0, 380),
        text: String(d.text || "").slice(0, 7500),
        selection: String(d.selection || "").slice(0, 1900),
      };
      if (!isContinuation) {
        appendLog("missionLog", `${tag("muted", "ctx")} ${esc(d.title || d.url || "(tab)")}`);
      }
    }
  }

  appendLog("missionLog", `${tag("info", "plan")} ${isContinuation ? "re-" : ""}requesting…`);

  let plan;
  let planner = "";
  let planFinal = "";
  try {
    const payload = {
      task: String(task).slice(0, 1900),
      tenantId: state.cfg.tenantId || undefined,
    };
    if (tabContext) payload.tabContext = tabContext;
    const r = await fetch(`${state.cfg.endpoint}/api/browse-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok || !j.plan) {
      const reason =
        r.status === 429
          ? "rate-limited · retry in ~30s"
          : j.detail
            ? `${j.error || "error"} · ${String(j.detail).slice(0, 200)}`
            : j.error || `HTTP ${r.status}`;
      appendLog("missionLog", `${tag("bad", "ERR")} ${esc(reason)}`);
      return;
    }
    plan = j.plan;
    planner = j.planner || "";
    planFinal = j.final || "";
    appendLog("missionLog", `${tag("ok", "plan")} ${plan.length} steps · ${esc(planner)}`);
    if (planFinal) appendLog("missionLog", `<div class="muted">${esc(planFinal)}</div>`);
    if (j.memorySynced) {
      appendLog(
        "missionLog",
        `${tag("muted", "★ memory")} synced to ${esc(state.cfg.tenantId || "delrio_demo")}`,
      );
      if (state.activeTab === "memory") memoryRefresh();
    }
  } catch (e) {
    appendLog("missionLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
    return;
  }

  // External approval batch
  const externalCount = plan.filter((s) => s.tier === "external").length;
  let externalApproved = false;
  if (externalCount > 0) {
    externalApproved = confirm(
      `Plan has ${externalCount} external step${externalCount === 1 ? "" : "s"} (form submits / nav). Approve all in one go?`,
    );
    if (!externalApproved) {
      appendLog("missionLog", `${tag("warn", "external")} ${externalCount} step(s) will be skipped`);
    }
  }

  const stepResults = [];
  let lastAnswerText = "";
  // EXT-V6 · accumulate extract/summarize/read output so we can synthesize a
  // real final answer when the planner left a placeholder.
  const collectedContext = [];
  for (let i = 0; i < plan.length; i++) {
    if (state.stop) {
      appendLog("missionLog", `${tag("warn", "stopped")} by user`);
      tabAction("banner", { message: "stopped by user", kind: "info", durationMs: 1800 }).catch(() => {});
      break;
    }
    const step = plan[i];
    const label = `${i + 1}/${plan.length}`;
    appendLog(
      "missionLog",
      `${tag(step.tier === "destructive" ? "bad" : step.tier === "external" ? "warn" : "info", label)} ${esc(step.action)} ${esc(JSON.stringify(step.args).slice(0, 120))}`,
    );

    const bannerKind =
      step.tier === "destructive"
        ? "destructive"
        : step.action === "navigate"
          ? "nav"
          : step.action === "fill"
            ? "fill"
            : step.action === "click"
              ? "click"
              : "info";
    const subtitle = step.args?.url || step.args?.needle || step.args?.field || step.args?.query || "";
    tabAction("banner", {
      message: `${label} · ${step.action}`,
      subtitle: String(subtitle).slice(0, 120),
      kind: bannerKind,
      durationMs: 2400,
    }).catch(() => {});

    if (step.tier === "destructive") {
      const ok = confirm(`DESTRUCTIVE step ${label}:\n${step.action} ${JSON.stringify(step.args)}\n\nApprove?`);
      if (!ok) {
        appendLog("missionLog", `${tag("warn", "skip")} user denied`);
        continue;
      }
    } else if (step.tier === "external") {
      if (!externalApproved) {
        appendLog("missionLog", `${tag("warn", "skip")} external (not approved)`);
        continue;
      }
    }

    try {
      if (step.action === "answer") {
        let text = String(step.args.text || "");
        // EXT-V6 · synthesize when the planner left a placeholder. Feed all
        // collected extract/summarize/read content into quick-agent and ask
        // for a thorough direct answer with concrete details.
        const isPlaceholder = !text || /synthesis pending|i'?ll (open|search|navigate|browse|find)/i.test(text);
        if (isPlaceholder && collectedContext.length > 0) {
          appendLog("missionLog", `${tag("muted", "synth")} composing direct answer from ${collectedContext.length} extract${collectedContext.length === 1 ? "" : "s"}`);
          try {
            const synthPrompt = `You are a research synthesizer. The user asked:\n\n"${task}"\n\nHere is the content the browser agent collected from the pages it visited:\n\n${collectedContext.join("\n\n---\n\n").slice(0, 6000)}\n\nWrite a thorough, direct, specific answer in 4-8 sentences. Include concrete details: product names, prices, key features, links if present. Do not say "based on the search results" or "I found". Just give the answer.`;
            const r = await fetch(`${state.cfg.endpoint}/api/quick-agent`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ input: synthPrompt, tenantId: state.cfg.tenantId }),
            });
            const j = await r.json();
            if (j.text) text = j.text;
          } catch {
            /* fall back to whatever the planner gave us */
          }
        }
        lastAnswerText = text;
        appendLog("missionLog", `<div class="answer">${tag("info", "answer")} ${esc(text)}</div>`);
        stepResults.push(`answer: ${text.slice(0, 240)}`);
        continue;
      }
      if (step.action === "summarize" || step.action === "extract") {
        const d = await safeReadTab("missionLog");
        if (!d) {
          stepResults.push(`${step.action} skipped: unscriptable page`);
          continue;
        }
        const q = step.args.query || task;
        const prompt =
          step.action === "summarize"
            ? `Summarize this page in 4-6 concise bullets.\n\nURL: ${d.url}\nTITLE: ${d.title}\n\n${(d.text || "").slice(0, 5000)}`
            : `Extract only what's relevant to: ${q}\n\nURL: ${d.url}\nTITLE: ${d.title}\n\n${(d.text || "").slice(0, 5000)}`;
        const r = await fetch(`${state.cfg.endpoint}/api/quick-agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: prompt, tenantId: state.cfg.tenantId }),
        });
        const j = await r.json();
        const result = j.text || j.error || "(no result)";
        appendLog("missionLog", `<div class="answer">${tag("ok", step.action)} ${esc(result)}</div>`);
        // EXT-V6 · collect for synthesis at the final answer step.
        collectedContext.push(`From ${d.url}:\n${result}`);
        lastAnswerText = result;
        stepResults.push(`${step.action}: ${result.slice(0, 300)}`);
        continue;
      }
      const navUrl =
        step.args.url ||
        step.args.query ||
        (step.action === "navigate"
          ? "https://duckduckgo.com/?q=" + encodeURIComponent(task)
          : "");
      const map = {
        navigate: ["navigate", { url: navUrl }],
        scroll: ["scroll", { direction: step.args.direction || "down", amount: step.args.amount || 800 }],
        click: ["click", { needle: step.args.needle }],
        fill: ["fill", { field: step.args.field, value: step.args.value }],
        read: ["read", {}],
        links: ["links", { limit: step.args.limit || 20 }],
      };
      const [act, args] = map[step.action] || [step.action, step.args];
      const result = await tabAction(act, args);
      if (result?.ok) {
        appendLog("missionLog", `${tag("ok", "✓")} ${esc(JSON.stringify(result.data || {}).slice(0, 160))}`);
        stepResults.push(`${act}(${JSON.stringify(args).slice(0, 80)}) ok`);
        // EXT-V6 · grab page text after navigate so the synthesis step has
        // raw material even when the planner skipped an explicit extract.
        if (act === "navigate") {
          await new Promise((r) => setTimeout(r, 1800)); // let nav complete + render
          const after = await tabAction("read");
          if (after?.ok && after.data?.text) {
            collectedContext.push(`From ${after.data.url || "page"}:\n${String(after.data.text).slice(0, 2500)}`);
          }
        } else if (act === "read" && result.data?.text) {
          collectedContext.push(`From ${result.data.url || "page"}:\n${String(result.data.text).slice(0, 2500)}`);
        } else if (act === "links" && Array.isArray(result.data)) {
          collectedContext.push(`Links found:\n${result.data.slice(0, 10).map((l) => `${l.text} ${l.href}`).join("\n")}`);
        }
      } else {
        // EXT-V5-2 · friendly skip for chrome:// failures during a step.
        const err = String(result?.error || "");
        if (/chrome:\/\/|edge:\/\/|cannot access/i.test(err)) {
          appendLog("missionLog", `${tag("muted", "skip")} can't act on browser-internal pages · open a real site`);
          stepResults.push(`${act} skipped: browser-internal page`);
        } else {
          appendLog("missionLog", `${tag("bad", "✗")} ${esc(err)}`);
          stepResults.push(`${act} failed: ${err.slice(0, 80)}`);
        }
      }
      const mutating = ["navigate", "click", "fill", "scroll"];
      if ($("#missionScreenshots")?.checked && mutating.includes(act)) {
        await new Promise((r) => setTimeout(r, act === "navigate" ? 1500 : 400));
        await captureAndLog("missionLog", `${label} · ${step.action}`);
      }
      await new Promise((r) => setTimeout(r, 600));
    } catch (e) {
      appendLog("missionLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
      stepResults.push(`error: ${String(e.message || "").slice(0, 80)}`);
    }
  }
  appendLog("missionLog", `${tag("ok", isContinuation ? "round done" : "done")}`);
  tabAction("banner", {
    message: "done",
    subtitle: `${plan.length} step${plan.length === 1 ? "" : "s"} executed`,
    kind: "nav",
    durationMs: 3000,
  }).catch(() => {});

  // Save the agent answer to the conversation thread so follow-ups have context.
  const summary = stepResults.join("\n");
  state.lastPlanSummary = (state.lastPlanSummary ? state.lastPlanSummary + "\n" : "") + summary;
  if (lastAnswerText) state.thread.push({ role: "agent", text: lastAnswerText });
  else if (planFinal) state.thread.push({ role: "agent", text: planFinal });

  // EXT-V4-5 · chain re-plan up to 3 rounds for endlessly complex tasks.
  const lastAction = plan[plan.length - 1]?.action;
  const completed = lastAction === "answer" || stepResults.some((s) => s.startsWith("answer:"));
  const btn = $("#missionRunBtn");
  const round = parseInt(btn?.dataset.round || "0", 10);
  if (!state.stop && !completed && $("#missionChain")?.checked && round < 2) {
    btn.dataset.round = String(round + 1);
    appendLog("missionLog", `${tag("info", "chain")} round ${round + 2} · agent re-planning`);
    await new Promise((r) => setTimeout(r, 800));
    const cont = `Continue this multi-step task. Original goal: ${state.thread[0]?.text || taskRaw}\n\nWhat has been done:\n${state.lastPlanSummary.slice(-1500)}\n\nReturn next concrete steps; mark "answer" if goal is satisfied.`;
    await runMission(true, cont);
  } else {
    btn.dataset.round = "0";
    // Focus follow-up input so user knows the conversation continues.
    $("#convoInput")?.focus();
  }
}

// EXT-V5-3 · Endless conversation · every follow-up reuses thread context.
// If the follow-up implies a fresh browser action (open / find / search /
// navigate / scroll / click / fill etc.), we re-run the agent flow.
// Otherwise it's a text Q over prior context → /api/quick-agent.
$("#convoBtn")?.addEventListener("click", askConvo);
$("#convoInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    askConvo();
  }
});

function impliesBrowse(text) {
  const t = text.toLowerCase();
  return /(open|go to|visit|navigate|search|find|browse|click|fill|scroll|read this|summarize|extract|book|order|buy|book me|sign in|log in)/.test(t);
}

async function askConvo() {
  const q = $("#convoInput")?.value.trim();
  if (!q) return;
  appendLog("missionLog", `<b>YOU</b> ${esc(q)}`);
  $("#convoInput").value = "";
  state.thread.push({ role: "user", text: q });

  if (impliesBrowse(q)) {
    // Re-engage the browser agent with the new follow-up as the task,
    // carrying prior conversation as context.
    const origGoal = state.thread.find((m) => m.role === "user")?.text || q;
    const prior = state.thread
      .slice(-6)
      .map((m) => `${m.role === "user" ? "USER" : "AGENT"}: ${m.text}`)
      .join("\n");
    const newTask = `${q}\n\n(continuing earlier work · original goal: ${origGoal}\nrecent exchange:\n${prior})`;
    $("#missionTask").value = newTask;
    $("#missionRunBtn").dataset.round = "0";
    await runMission(false);
    // Restore the user's original textarea value
    $("#missionTask").value = state.thread[0]?.text || origGoal;
    return;
  }

  // Pure text follow-up via quick-agent with prior context.
  const lastAnswer = [...state.thread].reverse().find((m) => m.role === "agent")?.text || "";
  const origGoal = state.thread.find((m) => m.role === "user")?.text || "";
  const prompt = [
    `Original mission: ${origGoal}`,
    lastAnswer ? `\nAgent's previous answer:\n${lastAnswer}` : "",
    `\nFollow-up question:\n${q}`,
    `\nAnswer concisely, building on the prior context.`,
  ].join("");
  try {
    const r = await fetch(`${state.cfg.endpoint}/api/quick-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: prompt,
        models: state.cfg.modelOverrides,
        tenantId: state.cfg.tenantId || undefined,
      }),
    });
    if (!r.ok) {
      const err = r.status === 429 ? "rate-limited · retry in ~30s" : `HTTP ${r.status}`;
      appendLog("missionLog", `${tag("bad", "agent")} ${esc(err)}`);
      return;
    }
    const j = await r.json();
    const reply = j.text || (j.error ? `err: ${j.error}` : "(no answer)");
    appendLog("missionLog", `<div class="answer">${tag("info", "follow-up")} ${esc(reply)}</div>`);
    state.thread.push({ role: "agent", text: reply });
    // Auto-save follow-up to memory so it's discoverable later
    fetch(`${state.cfg.endpoint}/api/memory/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Follow-up Q · ${q.slice(0, 200)} · A · ${reply.slice(0, 400)}`,
        tags: ["mission", "follow-up"],
        source: "assistant",
        tenantId: state.cfg.tenantId,
      }),
    }).catch(() => {});
    if (state.activeTab === "memory") memoryRefresh();
  } catch (e) {
    appendLog("missionLog", `${tag("bad", "agent")} ${esc(e.message)}`);
  }
}

// ───────────────────────── Mission quick actions ────────────────
$("#missionReadBtn")?.addEventListener("click", async () => {
  appendLog("missionLog", `${tag("info", "tab")} reading…`);
  const d = await safeReadTab("missionLog");
  if (!d) return;
  appendLog("missionLog", `<div class="muted">${esc(d.title || "(no title)")} · ${esc(d.url || "")}</div>`);
  appendLog("missionLog", `<div class="answer">${tag("ok", "text")} ${esc(String(d.text || "").slice(0, 1200))}…</div>`);
});

$("#missionSummarizeBtn")?.addEventListener("click", async () => {
  appendLog("missionLog", `${tag("info", "tab")} summarizing…`);
  const d = await safeReadTab("missionLog");
  if (!d) return;
  try {
    const r = await fetch(`${state.cfg.endpoint}/api/quick-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: `Summarize this page in 4-6 concise bullets.\n\nTITLE: ${d.title}\nURL: ${d.url}\n\n${(d.text || "").slice(0, 6000)}`,
        tenantId: state.cfg.tenantId || undefined,
      }),
    });
    const j = await r.json();
    appendLog(
      "missionLog",
      `<div class="answer">${tag("info", "summary")} ${esc(j.text || j.error || "(no result)")}</div>`,
    );
    if (j.text) state.thread.push({ role: "agent", text: j.text });
  } catch (e) {
    appendLog("missionLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
  }
});

$("#missionSaveMemBtn")?.addEventListener("click", async () => {
  const d = await safeReadTab("missionLog");
  if (!d) return;
  const text = `Saved · ${d.title || "(no title)"} · ${d.url || ""} · excerpt: ${String(d.text || "").slice(0, 400)}`;
  try {
    const r = await fetch(`${state.cfg.endpoint}/api/memory/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        tags: ["mission", "user-save"],
        source: "browser-search",
        tenantId: state.cfg.tenantId,
      }),
    });
    if (!r.ok) {
      appendLog("missionLog", `${tag("bad", "ERR")} memory save HTTP ${r.status}`);
      return;
    }
    appendLog("missionLog", `${tag("ok", "★ saved")} ${esc(d.title || d.url || "tab")}`);
    if (state.activeTab === "memory") memoryRefresh();
  } catch (e) {
    appendLog("missionLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
  }
});

// ───────────────────────── cohort ─────────────────────────────────
$("#cohortBtn").addEventListener("click", runCohort);

async function runCohort() {
  $("#cohortResults").innerHTML = "";
  const preset = $("#cohortPreset").value;
  let members;
  let godMode = false;
  if (preset === "3groq")
    members = [
      "groq:openai/gpt-oss-120b",
      "groq:openai/gpt-oss-20b",
      "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
    ];
  else if (preset === "fast")
    members = ["groq:openai/gpt-oss-20b", "mistral:mistral-large-latest", "google:gemini-2.5-flash"];
  else if (preset === "godmode") {
    godMode = true;
    members = ["mistral:mistral-large-latest", "google:gemini-2.5-flash", "groq:openai/gpt-oss-20b"];
  } else
    members = ["groq:openai/gpt-oss-120b", "google:gemini-2.5-flash", "mistral:mistral-large-latest"];

  const goal = $("#cohortGoal").value.trim();
  if (!goal) {
    appendLog("cohortResults", `${tag("bad", "ERR")} goal required`);
    return;
  }
  appendLog(
    "cohortResults",
    `${tag("info", "cohort")} ${godMode ? "GOD MODE · 5 models + NIM verifier" : members.length + " members"}`,
  );
  try {
    const url = `${state.cfg.endpoint}/api/cohort${godMode ? "?godMode=1" : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: goal, goal, members }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const friendly =
        res.status === 429
          ? "rate-limited · try in ~30s"
          : `HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`;
      appendLog("cohortResults", `${tag("bad", "ERR")} ${esc(friendly)}`);
      return;
    }
    if (!res.body) throw new Error("no stream");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let finalText = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const p of parts) {
        const line = p.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.t === "cohort_member") {
            const label = ev.model.split(":").pop();
            if (ev.status === "spawn")
              appendLog("cohortResults", `${tag("warn", "spawn")} [${ev.index}] ${esc(label)}`);
            else if (ev.status === "done")
              appendLog(
                "cohortResults",
                `${tag("ok", `[${ev.index}]`)} ${esc(label)} ${tag("muted", ev.ms + "ms")} <div class="muted">${esc(ev.text)}</div>`,
              );
            else if (ev.status === "fail")
              appendLog(
                "cohortResults",
                `${tag("bad", `[${ev.index}]`)} ${esc(label)} err: ${esc(ev.error)}`,
              );
          } else if (ev.t === "cohort_disagreement") {
            const pct = Math.round((ev.score || 0) * 100);
            const tone = pct > 30 ? "warn" : "ok";
            appendLog(
              "cohortResults",
              `${tag(tone, "disagreement")} ${pct}% ${pct > 30 ? "· cite required" : "· consensus"}`,
            );
          } else if (ev.t === "cohort_verdict") {
            const scores = (ev.scores || []).map((s) => `[${s.index}]${s.score}`).join(" ");
            finalText = ev.merged || "";
            appendLog(
              "cohortResults",
              `<div class="answer">${tag("info", "JUDGE")} winner [${ev.winnerIndex}] · ${esc(scores)}<br>${tag("info", "merged")}<br>${esc(ev.merged)}</div>`,
            );
          } else if (ev.t === "error") {
            appendLog("cohortResults", `${tag("bad", "ERR")} ${esc(ev.message)}`);
          }
        } catch {}
      }
    }
    // Auto-save cohort verdict to memory
    if (finalText) {
      fetch(`${state.cfg.endpoint}/api/memory/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `Cohort · ${goal.slice(0, 160)} · ${finalText.slice(0, 400)}`,
          tags: ["cohort", "verdict"],
          source: "assistant",
          tenantId: state.cfg.tenantId,
        }),
      }).catch(() => {});
      if (state.activeTab === "memory") memoryRefresh();
    }
  } catch (e) {
    appendLog("cohortResults", `${tag("bad", "ERR")} ${esc(e.message)}`);
  }
}

// ───────────────────────── memory ────────────────────────────────
$("#memRecallBtn")?.addEventListener("click", memoryRecall);
$("#memRefreshBtn")?.addEventListener("click", memoryRefresh);
$("#memSaveBtn")?.addEventListener("click", memorySave);
$("#memQuery")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    memoryRecall();
  }
});
$("#memNewText")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    memorySave();
  }
});

async function memoryRecall() {
  const q = $("#memQuery")?.value.trim();
  if (!q) return memoryRefresh();
  $("#memLog").innerHTML = "";
  appendLog("memLog", `${tag("muted", "…")} querying "${esc(q)}"`);
  try {
    const t = state.cfg.tenantId;
    const tParam = t ? `&tenant=${encodeURIComponent(t)}` : "";
    const url = `${state.cfg.endpoint}/api/memory?q=${encodeURIComponent(q)}&topK=12${tParam}`;
    const r = await fetch(url);
    if (!r.ok) {
      appendLog("memLog", `${tag("bad", "ERR")} HTTP ${r.status}`);
      return;
    }
    const j = await r.json();
    $("#memLog").innerHTML = "";
    const total = (j.hits?.length ?? 0) + (j.local?.length ?? 0);
    if (total === 0) {
      appendLog("memLog", `<span class="empty">no matches for "${esc(q)}"</span>`);
      return;
    }
    appendLog("memLog", `${tag("info", "hits")} ${total} for "${esc(q)}"`);
    for (const h of j.hits || []) renderMemoryEntry(h);
    for (const m of j.local || []) renderMemoryEntry(m);
  } catch (e) {
    appendLog("memLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
  }
}

async function memoryRefresh() {
  $("#memLog").innerHTML = "";
  appendLog("memLog", `${tag("muted", "…")} loading memory`);
  try {
    const t = state.cfg.tenantId;
    const tParam = t ? `&tenant=${encodeURIComponent(t)}` : "";
    const url = `${state.cfg.endpoint}/api/memory?q=&topK=25${tParam}`;
    const r = await fetch(url);
    if (!r.ok) {
      appendLog("memLog", `${tag("bad", "ERR")} HTTP ${r.status}`);
      return;
    }
    const j = await r.json();
    $("#memLog").innerHTML = "";
    const total = (j.hits?.length ?? 0) + (j.local?.length ?? 0);
    if (total === 0) {
      appendLog(
        "memLog",
        `<span class="empty">no memories yet · run a Mission or click ★ Save above</span>`,
      );
      return;
    }
    appendLog(
      "memLog",
      `${tag("ok", "memory")} ${total} entries · tenant <code>${esc(state.cfg.tenantId)}</code>`,
    );
    for (const h of j.hits || []) renderMemoryEntry(h);
    for (const m of j.local || []) renderMemoryEntry(m);
  } catch (e) {
    appendLog("memLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
  }
}

function renderMemoryEntry(m) {
  const tags = (m.tags || []).map((t) => `<span class="tag muted">${esc(t)}</span>`).join("");
  const score = m.score != null ? `<span class="tag muted">s=${m.score.toFixed(2)}</span>` : "";
  const id = m.id || "";
  const html =
    `<div class="memrow" style="border-left:2px solid var(--accent,#fbc531);padding:6px 8px;margin-bottom:6px;background:rgba(255,255,255,0.02);cursor:pointer" data-id="${esc(id)}" title="click to copy">` +
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:3px">` +
    `<div>${tags} ${score}</div>` +
    `<button class="ghost small mem-del-btn" data-id="${esc(id)}" style="font-size:10px;padding:1px 5px">✕</button>` +
    `</div>` +
    `<div style="font-size:12px;line-height:1.4">${esc(m.text)}</div>` +
    `</div>`;
  const el = $("#memLog");
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  el.appendChild(wrap.firstChild);
  const row = el.lastElementChild;
  row.addEventListener("click", (e) => {
    if (e.target.classList.contains("mem-del-btn")) return;
    navigator.clipboard?.writeText(m.text).catch(() => {});
    row.style.outline = "2px solid var(--accent)";
    setTimeout(() => (row.style.outline = "none"), 500);
  });
  row.querySelector(".mem-del-btn")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!id) return;
    if (!confirm("Delete this memory?")) return;
    try {
      const r = await fetch(`${state.cfg.endpoint}/api/memory/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, tenantId: state.cfg.tenantId }),
      });
      if (r.ok) row.remove();
      else appendLog("memLog", `${tag("bad", "ERR")} delete HTTP ${r.status}`);
    } catch (err) {
      appendLog("memLog", `${tag("bad", "ERR")} ${esc(err.message)}`);
    }
  });
}

async function memorySave() {
  const text = $("#memNewText")?.value.trim();
  if (!text) return;
  try {
    const r = await fetch(`${state.cfg.endpoint}/api/memory/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        tags: ["user-write"],
        source: "user-fact",
        tenantId: state.cfg.tenantId,
      }),
    });
    if (!r.ok) {
      appendLog("memLog", `${tag("bad", "ERR")} HTTP ${r.status}`);
      return;
    }
    $("#memNewText").value = "";
    memoryRefresh();
  } catch (e) {
    appendLog("memLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
  }
}

// ───────────────────────── boot ─────────────────────────────────
(async function init() {
  await loadCfg();
  renderSettings();
  refreshConn();
  const stored = await chrome.storage.local.get("pendingGoal");
  if (stored.pendingGoal) {
    $("#missionTask").value = stored.pendingGoal;
    await chrome.storage.local.remove("pendingGoal");
  }
  $("#cohortResults").innerHTML = '<div class="empty">no cohort run yet</div>';
  $("#missionLog").innerHTML = '<div class="empty">give the agent any complex task above · it will plan, browse, click, fill, summarize, and chat with you</div>';
  $("#memLog").innerHTML = '<div class="empty">memory loading…</div>';
  state.activeTab = "mission";
  // EXT-V5-4 · auto-refresh memory every 30s when the Memory tab is visible
  // so changes from the OS site appear without manual refresh.
  setInterval(() => {
    if (state.activeTab === "memory") memoryRefresh();
  }, 30000);
  setInterval(refreshConn, 15000);
})();
