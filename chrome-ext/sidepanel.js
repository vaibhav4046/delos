// DelOS side panel v3.0 — autonomous browser agent.
//
// EXT-V4 · Voice tab removed entirely. Browse is the headline flow. Memory
// tab restored as interactive + cross-device synced. TTS gone. D logo
// everywhere. Connection check is now resilient to transient flake.

// MODELS list trimmed to 7 verified-connected providers.
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
  runCtrl: null,
  runId: null,
  activeTab: "browse",
  runBase: Date.now(),
  lastConnOk: false,
  lastConnAt: 0,
};

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

// ───────────────────────── connection (V4-4 hardened) ────────────
// Resilient health check · retries 3× with 250ms/600ms backoff before
// flipping the pill to "offline". Caches the last-good state so a single
// failed probe never shows red. Click pill to force re-check.
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
  // 3 attempts with light backoff so a transient cold-lambda doesn't show offline.
  for (let i = 0; i < 3; i++) {
    ok = await probeHealth();
    if (ok) break;
    if (i < 2) await new Promise((res) => setTimeout(res, 250 + i * 350));
  }
  state.lastConnOk = ok;
  state.lastConnAt = Date.now();
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
    // Auto-load memory list when user opens the Memory tab.
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
function setStats(s) {
  const el = $("#stats");
  if (!el) return;
  el.innerHTML =
    ["tok in", "tok out", "calls", "ms"]
      .map(
        (k, i) =>
          `<div class="stat"><div class="v">${s[i] ?? 0}</div><div class="k">${k}</div></div>`,
      )
      .join("") + `<div class="stat"><div class="v">${s[4] ?? "·"}</div><div class="k">cost</div></div>`;
}

function renderEvent(ev) {
  const t = ((ev.at - state.runBase) / 1000).toFixed(2) + "s";
  const muted = (text) => `<span class="muted">${esc(text)}</span>`;
  switch (ev.t) {
    case "meta":
      state.runId = ev.runId;
      return `${muted(t)} ${tag("info", "meta")} runId=${ev.runId}`;
    case "phase":
      return `${muted(t)} ${tag("info", ev.phase)} ${esc(ev.note ?? "")}`;
    case "thought":
      return `${muted(t)} ${tag("muted", ev.agent)} ${esc(ev.text)}`;
    case "tool_call":
      return `${muted(t)} ${tag("info", "→")} ${esc(ev.name)} ${muted(JSON.stringify(ev.args).slice(0, 80))}`;
    case "tool_result":
      return `${muted(t)} ${tag(ev.ok ? "ok" : "bad", ev.ok ? "✓" : "✗")} ${esc(ev.name)} ${muted(ev.ok ? JSON.stringify(ev.result).slice(0, 80) : ev.error)}`;
    case "recover":
      return `${muted(t)} ${tag("ok", "1-UP")} ${esc(ev.strategy)} ${muted("— " + ev.reason)}`;
    case "adapt":
      return `${muted(t)} ${tag("warn", "WARP")} ${esc(ev.reason)}`;
    case "subagent":
      return `${muted(t)} ${tag(ev.status === "done" ? "ok" : ev.status === "fail" ? "bad" : "warn", "sub " + ev.status)} ${esc(ev.result ?? ev.goal.slice(0, 60))}`;
    case "memory_write":
      return `${muted(t)} ${tag("info", "★ save")} ${esc(ev.preview)}`;
    case "memory_recall":
      return `${muted(t)} ${tag("info", "recall")} ${ev.hits} hits`;
    case "usage":
      return `${muted(t)} ${tag("muted", "llm")} <b>${esc(ev.role)}</b> ${muted(ev.model)} ${ev.promptTokens}→${ev.completionTokens}t ${muted(ev.ms + "ms")}`;
    case "metric":
      return `${muted(t)} ${tag("muted", "m")} ${esc(ev.key)}=${ev.value}`;
    case "answer":
      return `<div class="answer">${tag("info", "answer")} ${esc(ev.text)}</div>`;
    case "error": {
      const raw = String(ev.message ?? "");
      let friendly = raw;
      if (/provider|429|rate.?limit/i.test(raw)) friendly = "Provider rate-limited · agent fell back. Retry in ~30s.";
      else if (/timeout/i.test(raw)) friendly = "LLM call timed out · retry in a moment.";
      else if (/api.?key|unauthor/i.test(raw)) friendly = "Auth issue with upstream provider · check env.";
      return `${muted(t)} ${tag("bad", "ERR")} ${esc(friendly)}`;
    }
  }
  return "";
}

// ───────────────────────── mission run ───────────────────────────
const runStats = { pin: 0, pout: 0, calls: 0, llmMs: 0 };
let missionThread = [];

$("#runBtn").addEventListener("click", run);
$("#stopBtn").addEventListener("click", () => state.runCtrl?.abort());
$("#steerBtn").addEventListener("click", sendSteer);
$("#grabTab").addEventListener("click", grabTabContext);

async function grabTabContext() {
  const res = await tabAction("read");
  if (!res?.ok) return appendLog("log", `${tag("bad", "tab")} ${esc(res?.error || "no data")}`);
  const ctx = res.data;
  $("#goal").value = `Based on this page (${ctx.url}):\n${ctx.text.slice(0, 800)}\n\n${$("#goal").value || "summarize in 3 bullets."}`;
}

async function run() {
  state.runCtrl?.abort();
  const ctrl = new AbortController();
  state.runCtrl = ctrl;
  state.runId = null;
  state.runBase = Date.now();
  runStats.pin = 0; runStats.pout = 0; runStats.calls = 0; runStats.llmMs = 0;
  setStats([0, 0, 0, 0, "$0"]);
  $("#log").innerHTML = "";
  $("#steerRow").classList.remove("hidden");
  missionThread = [{ role: "user", text: $("#goal").value.trim() }];
  $("#followupRow")?.classList.add("hidden");

  const chaos = $$("input[data-chaos]").filter((c) => c.checked).map((c) => c.dataset.chaos);
  const useMcp = $("#useMcp").checked;
  const body = {
    goal: $("#goal").value.trim(),
    chaos,
    maxSteps: 5,
    models: state.cfg.modelOverrides,
    tenantId: state.cfg.tenantId || undefined,
    mcpServers: useMcp ? state.cfg.mcpServers.map((s) => ({ ...s, url: rewriteUrl(s.url) })) : [],
  };
  if (!body.goal) {
    appendLog("log", `${tag("bad", "ERR")} goal required`);
    return;
  }

  try {
    const res = await fetch(`${state.cfg.endpoint}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, input: body.goal }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const friendly = res.status === 429 ? "rate-limited · try in ~30s" : `HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`;
      appendLog("log", `${tag("bad", "ERR")} ${esc(friendly)}`);
      return;
    }
    if (!res.body) throw new Error("no stream");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
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
          appendLog("log", renderEvent(ev));
          if (ev.t === "usage") {
            runStats.pin += ev.promptTokens;
            runStats.pout += ev.completionTokens;
            runStats.calls += 1;
            runStats.llmMs += ev.ms;
            setStats([runStats.pin, runStats.pout, runStats.calls, runStats.llmMs, "·"]);
          }
          if (
            $("#missionScreenshots")?.checked &&
            ev.t === "tool_result" &&
            ev.ok &&
            /tab|browse|navigate|click|fill|scroll/i.test(String(ev.name || ""))
          ) {
            captureAndLog("log", ev.name).catch(() => {});
          }
          if (ev.t === "answer" && ev.text) {
            missionThread.push({ role: "agent", text: String(ev.text) });
          }
        } catch {}
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") appendLog("log", `${tag("bad", "ERR")} ${esc(e.message)}`);
  } finally {
    $("#steerRow").classList.add("hidden");
    if ($("#missionFollowups")?.checked && missionThread.some((m) => m.role === "agent")) {
      $("#followupRow")?.classList.remove("hidden");
      $("#followupInput")?.focus();
    }
  }
}

// Follow-up handler · chains a prior-answer-aware /quick-agent call.
$("#followupBtn")?.addEventListener("click", askFollowup);
$("#followupInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    askFollowup();
  }
});

async function askFollowup() {
  const q = $("#followupInput")?.value.trim();
  if (!q) return;
  const lastAnswer = [...missionThread].reverse().find((m) => m.role === "agent")?.text || "";
  const origGoal = missionThread.find((m) => m.role === "user")?.text || "";
  appendLog("log", `<b>YOU</b> ${esc(q)}`);
  $("#followupInput").value = "";
  missionThread.push({ role: "user", text: q });
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
      appendLog("log", `${tag("bad", "agent")} ${esc(r.status === 429 ? "rate-limited · retry in ~30s" : `HTTP ${r.status}`)}`);
      return;
    }
    const j = await r.json();
    const reply = j.text || (j.error ? `err: ${j.error}` : "(no answer)");
    appendLog("log", `<div class="answer">${tag("info", "follow-up")} ${esc(reply)}</div>`);
    missionThread.push({ role: "agent", text: reply });
  } catch (e) {
    appendLog("log", `${tag("bad", "agent")} ${esc(e.message)}`);
  }
}

async function sendSteer() {
  if (!state.runId) return;
  const v = $("#steerInput").value.trim();
  if (!v) return;
  try {
    await fetch(`${state.cfg.endpoint}/api/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: state.runId, instruction: v }),
    });
    $("#steerInput").value = "";
  } catch (e) {
    appendLog("log", `${tag("bad", "steer")} ${esc(e.message)}`);
  }
}

function rewriteUrl(u) {
  if (u?.startsWith("/")) return `${state.cfg.endpoint}${u}`;
  return u;
}

// ───────────────────────── browse agent (V3 + V4 chaining) ───────
$("#browseRunBtn")?.addEventListener("click", () => runBrowseAgent(false));
let browseStop = false;
$("#browseStopBtn")?.addEventListener("click", () => { browseStop = true; });

async function runBrowseAgent(isContinuation = false, prevSummary = "") {
  const taskRaw = $("#browseTask").value.trim();
  const task = isContinuation
    ? `Continue this multi-step task. Original goal: ${taskRaw}\n\nWhat has been done so far:\n${prevSummary}\n\nReturn next concrete steps; mark "answer" if the goal is fully achieved.`
    : taskRaw;
  if (!taskRaw) {
    appendLog("browseLog", `${tag("bad", "ERR")} task required`);
    return;
  }
  if (!isContinuation) {
    $("#browseLog").innerHTML = "";
    browseStop = false;
    appendLog("browseLog", `${tag("info", "task")} ${esc(taskRaw)}`);
  }
  await tabAction("overlay_boot");
  await tabAction("banner", { message: isContinuation ? "re-planning" : "planning", subtitle: taskRaw.slice(0, 120), kind: "info", durationMs: 3500 });

  let tabContext = null;
  if ($("#browseUseTab")?.checked) {
    const r = await tabAction("read");
    if (r?.ok && r.data) {
      tabContext = {
        url: String(r.data.url || "").slice(0, 380),
        title: String(r.data.title || "").slice(0, 380),
        text: String(r.data.text || "").slice(0, 7500),
        selection: String(r.data.selection || "").slice(0, 1900),
      };
      if (!isContinuation) {
        appendLog("browseLog", `${tag("muted", "ctx")} ${esc(r.data.title || r.data.url || "(tab)")}`);
      }
    } else if (r && !r.ok && !isContinuation) {
      appendLog("browseLog", `${tag("muted", "ctx")} skipped (${esc(r.error || "no tab")})`);
    }
  }

  appendLog("browseLog", `${tag("info", "plan")} ${isContinuation ? "re-" : ""}requesting…`);
  let plan;
  let planSummary = prevSummary;
  let planFinal = "";
  try {
    const payload = { task: String(task).slice(0, 1900), tenantId: state.cfg.tenantId || undefined };
    if (tabContext) payload.tabContext = tabContext;
    const r = await fetch(`${state.cfg.endpoint}/api/browse-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok || !j.plan) {
      const reason = r.status === 429
        ? "rate-limited · retry in ~30s"
        : j.detail
          ? `${j.error || "error"} · ${String(j.detail).slice(0, 200)}`
          : (j.error || `HTTP ${r.status}`);
      appendLog("browseLog", `${tag("bad", "ERR")} ${esc(reason)}`);
      return;
    }
    plan = j.plan;
    planFinal = j.final || "";
    appendLog("browseLog", `${tag("ok", "plan")} ${plan.length} steps · ${esc(j.planner || "")}`);
    if (planFinal) appendLog("browseLog", `<div class="muted">${esc(planFinal)}</div>`);
    if (j.memorySynced) {
      appendLog("browseLog", `${tag("muted", "★ memory")} synced to ${esc(state.cfg.tenantId || "delrio_demo")}`);
      // Refresh memory tab list if user is looking at it
      if (state.activeTab === "memory") memoryRefresh();
    }
  } catch (e) {
    appendLog("browseLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
    return;
  }

  const externalCount = plan.filter((s) => s.tier === "external").length;
  let externalApproved = false;
  if (externalCount > 0) {
    externalApproved = confirm(`Plan has ${externalCount} external step${externalCount === 1 ? "" : "s"} (form submits / nav). Approve all in one go?`);
    if (!externalApproved) appendLog("browseLog", `${tag("warn", "external")} ${externalCount} step(s) will be skipped`);
  }

  const stepResults = [];
  for (let i = 0; i < plan.length; i++) {
    if (browseStop) {
      appendLog("browseLog", `${tag("warn", "stopped")} by user`);
      tabAction("banner", { message: "stopped by user", kind: "info", durationMs: 1800 }).catch(() => {});
      break;
    }
    const step = plan[i];
    const label = `${i + 1}/${plan.length}`;
    appendLog("browseLog", `${tag(step.tier === "destructive" ? "bad" : step.tier === "external" ? "warn" : "info", label)} ${esc(step.action)} ${esc(JSON.stringify(step.args).slice(0, 120))}`);
    const bannerKind = step.tier === "destructive" ? "destructive" : step.action === "navigate" ? "nav" : step.action === "fill" ? "fill" : step.action === "click" ? "click" : "info";
    const subtitle = step.args?.url || step.args?.needle || step.args?.field || step.args?.query || "";
    tabAction("banner", { message: `${label} · ${step.action}`, subtitle: String(subtitle).slice(0, 120), kind: bannerKind, durationMs: 2400 }).catch(() => {});

    if (step.tier === "destructive") {
      const ok = confirm(`DESTRUCTIVE step ${label}:\n${step.action} ${JSON.stringify(step.args)}\n\nApprove?`);
      if (!ok) {
        appendLog("browseLog", `${tag("warn", "skip")} user denied`);
        continue;
      }
    } else if (step.tier === "external") {
      if (!externalApproved) {
        appendLog("browseLog", `${tag("warn", "skip")} external (not approved)`);
        continue;
      }
    }

    try {
      if (step.action === "answer") {
        appendLog("browseLog", `<div class="answer">${tag("info", "answer")} ${esc(step.args.text || "")}</div>`);
        stepResults.push(`answer: ${String(step.args.text || "").slice(0, 200)}`);
        continue;
      }
      if (step.action === "summarize" || step.action === "extract") {
        const tabRes = await tabAction("read");
        if (!tabRes?.ok) throw new Error(tabRes?.error || "read failed");
        const q = step.args.query || task;
        const summarizePrompt = step.action === "summarize"
          ? `Summarize this page in 4-6 concise bullets.\n\nURL: ${tabRes.data.url}\nTITLE: ${tabRes.data.title}\n\n${(tabRes.data.text || "").slice(0, 5000)}`
          : `Extract from this page only what's relevant to: ${q}\n\nURL: ${tabRes.data.url}\nTITLE: ${tabRes.data.title}\n\n${(tabRes.data.text || "").slice(0, 5000)}`;
        const r = await fetch(`${state.cfg.endpoint}/api/quick-agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: summarizePrompt, tenantId: state.cfg.tenantId }),
        });
        const j = await r.json();
        const result = j.text || j.error || "(no result)";
        appendLog("browseLog", `<div class="answer">${tag("ok", step.action)} ${esc(result)}</div>`);
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
        appendLog("browseLog", `${tag("ok", "✓")} ${esc(JSON.stringify(result.data || {}).slice(0, 160))}`);
        stepResults.push(`${act}(${JSON.stringify(args).slice(0, 80)}) ok`);
      } else {
        appendLog("browseLog", `${tag("bad", "✗")} ${esc(result?.error || "failed")}`);
        stepResults.push(`${act} failed: ${String(result?.error || "").slice(0, 80)}`);
      }
      const mutating = ["navigate", "click", "fill", "scroll"];
      if ($("#browseScreenshots")?.checked && mutating.includes(act)) {
        await new Promise((r) => setTimeout(r, act === "navigate" ? 1500 : 400));
        await captureAndLog("browseLog", `${label} · ${step.action}`);
      }
      await new Promise((r) => setTimeout(r, 600));
    } catch (e) {
      appendLog("browseLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
      stepResults.push(`error: ${String(e.message || "").slice(0, 80)}`);
    }
  }
  appendLog("browseLog", `${tag("ok", isContinuation ? "round done" : "done")}`);
  tabAction("banner", { message: "done", subtitle: `${plan.length} step${plan.length === 1 ? "" : "s"} executed`, kind: "nav", durationMs: 3000 }).catch(() => {});

  // EXT-V4-5 · chain re-plan · if user enabled it and the plan ended on a
  // non-answer step (e.g. extract/read/scroll), ask the planner whether
  // anything else is needed to fully satisfy the original task. Up to 3
  // rounds total so we never loop forever.
  const lastAction = plan[plan.length - 1]?.action;
  const completed = lastAction === "answer" || stepResults.some((s) => s.startsWith("answer:"));
  planSummary = (planSummary ? planSummary + "\n" : "") + stepResults.join("\n");
  // Count continuations via simple data attr on the run btn.
  const btn = $("#browseRunBtn");
  const round = parseInt(btn?.dataset.round || "0", 10);
  if (
    !browseStop &&
    !completed &&
    $("#browseChain")?.checked &&
    round < 2
  ) {
    btn.dataset.round = String(round + 1);
    appendLog("browseLog", `${tag("info", "chain")} round ${round + 2} · re-planning to finish goal`);
    await new Promise((r) => setTimeout(r, 800));
    await runBrowseAgent(true, planSummary.slice(-1200));
  } else {
    btn.dataset.round = "0";
  }
}

// ───────────────────────── Browse tab quick actions (V3-3) ───────
$("#browseReadBtn")?.addEventListener("click", async () => {
  appendLog("browseLog", `${tag("info", "tab")} reading…`);
  const res = await tabAction("read");
  if (!res?.ok) {
    appendLog("browseLog", `${tag("bad", "ERR")} ${esc(res?.error || "read failed")}`);
    return;
  }
  const d = res.data || {};
  appendLog("browseLog", `<div class="muted">${esc(d.title || "(no title)")} · ${esc(d.url || "")}</div>`);
  appendLog("browseLog", `<div class="answer">${tag("ok", "text")} ${esc(String(d.text || "").slice(0, 1200))}…</div>`);
});

$("#browseSummarizeBtn")?.addEventListener("click", async () => {
  appendLog("browseLog", `${tag("info", "tab")} summarizing…`);
  const res = await tabAction("read");
  if (!res?.ok) {
    appendLog("browseLog", `${tag("bad", "ERR")} ${esc(res?.error || "read failed")}`);
    return;
  }
  const d = res.data || {};
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
    appendLog("browseLog", `<div class="answer">${tag("info", "summary")} ${esc(j.text || j.error || "(no result)")}</div>`);
  } catch (e) {
    appendLog("browseLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
  }
});

// EXT-V4-3 · save the active tab to memory directly from Browse.
$("#browseSaveMemBtn")?.addEventListener("click", async () => {
  const res = await tabAction("read");
  if (!res?.ok) {
    appendLog("browseLog", `${tag("bad", "ERR")} ${esc(res?.error || "read failed")}`);
    return;
  }
  const d = res.data || {};
  const text = `Saved · ${d.title || "(no title)"} · ${d.url || ""} · excerpt: ${String(d.text || "").slice(0, 400)}`;
  try {
    const r = await fetch(`${state.cfg.endpoint}/api/memory/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        tags: ["browser-search", "user-save"],
        source: "browser-search",
        tenantId: state.cfg.tenantId,
      }),
    });
    if (!r.ok) {
      appendLog("browseLog", `${tag("bad", "ERR")} memory save HTTP ${r.status}`);
      return;
    }
    appendLog("browseLog", `${tag("ok", "★ saved")} ${esc(d.title || d.url || "tab")}`);
    if (state.activeTab === "memory") memoryRefresh();
  } catch (e) {
    appendLog("browseLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
  }
});

// ───────────────────────── cohort ─────────────────────────────────
$("#cohortBtn").addEventListener("click", runCohort);

async function runCohort() {
  $("#cohortResults").innerHTML = "";
  const preset = $("#cohortPreset").value;
  let members;
  let godMode = false;
  if (preset === "3groq") members = ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b", "groq:meta-llama/llama-4-maverick-17b-128e-instruct"];
  else if (preset === "fast") members = ["groq:openai/gpt-oss-20b", "mistral:mistral-large-latest", "google:gemini-2.5-flash"];
  else if (preset === "godmode") { godMode = true; members = ["mistral:mistral-large-latest", "google:gemini-2.5-flash", "groq:openai/gpt-oss-20b"]; }
  else members = ["groq:openai/gpt-oss-120b", "google:gemini-2.5-flash", "mistral:mistral-large-latest"];

  const goal = $("#cohortGoal").value.trim();
  if (!goal) {
    appendLog("cohortResults", `${tag("bad", "ERR")} goal required`);
    return;
  }
  appendLog("cohortResults", `${tag("info", "cohort")} ${godMode ? "GOD MODE · 5 models + NIM verifier" : members.length + " members"}`);
  try {
    const url = `${state.cfg.endpoint}/api/cohort${godMode ? "?godMode=1" : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: goal, goal, members }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const friendly = res.status === 429 ? "rate-limited · try in ~30s" : `HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`;
      appendLog("cohortResults", `${tag("bad", "ERR")} ${esc(friendly)}`);
      return;
    }
    if (!res.body) throw new Error("no stream");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
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
            if (ev.status === "spawn") appendLog("cohortResults", `${tag("warn", "spawn")} [${ev.index}] ${esc(label)}`);
            else if (ev.status === "done") appendLog("cohortResults", `${tag("ok", `[${ev.index}]`)} ${esc(label)} ${tag("muted", ev.ms + "ms")} <div class="muted">${esc(ev.text)}</div>`);
            else if (ev.status === "fail") appendLog("cohortResults", `${tag("bad", `[${ev.index}]`)} ${esc(label)} err: ${esc(ev.error)}`);
          } else if (ev.t === "cohort_disagreement") {
            const pct = Math.round((ev.score || 0) * 100);
            const tone = pct > 30 ? "warn" : "ok";
            appendLog("cohortResults", `${tag(tone, "disagreement")} ${pct}% ${pct > 30 ? "· cite required" : "· consensus"}`);
          } else if (ev.t === "cohort_verdict") {
            const scores = (ev.scores || []).map((s) => `[${s.index}]${s.score}`).join(" ");
            appendLog("cohortResults", `<div class="answer">${tag("info", "JUDGE")} winner [${ev.winnerIndex}] · ${esc(scores)}<br>${tag("info", "merged")}<br>${esc(ev.merged)}</div>`);
          } else if (ev.t === "error") {
            appendLog("cohortResults", `${tag("bad", "ERR")} ${esc(ev.message)}`);
          }
        } catch {}
      }
    }
  } catch (e) {
    appendLog("cohortResults", `${tag("bad", "ERR")} ${esc(e.message)}`);
  }
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

// ───────────────────────── memory (V4-3 interactive) ─────────────
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
  if (!q) {
    return memoryRefresh();
  }
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
    for (const h of j.hits || []) renderMemoryEntry(h, true);
    for (const m of j.local || []) renderMemoryEntry(m, false);
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
      appendLog("memLog", `<span class="empty">no memories yet · run a Browse task or click ★ Save to memory above</span>`);
      return;
    }
    appendLog("memLog", `${tag("ok", "memory")} ${total} entries · tenant <code>${esc(state.cfg.tenantId)}</code>`);
    for (const h of j.hits || []) renderMemoryEntry(h, true);
    for (const m of j.local || []) renderMemoryEntry(m, false);
  } catch (e) {
    appendLog("memLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
  }
}

function renderMemoryEntry(m, isHit) {
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
  // Click row to copy, click ✕ to delete.
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
    $("#goal").value = stored.pendingGoal;
    await chrome.storage.local.remove("pendingGoal");
    $$(".tab").forEach((x) => x.classList.remove("on"));
    $$(".panel").forEach((x) => x.classList.remove("on"));
    $('[data-tab="mission"]')?.classList.add("on");
    $('[data-panel="mission"]')?.classList.add("on");
    state.activeTab = "mission";
  }
  $("#log").innerHTML = '<div class="empty">terminal ready <span class="cursor"></span></div>';
  $("#cohortResults").innerHTML = '<div class="empty">no cohort run yet</div>';
  $("#browseLog").innerHTML = '<div class="empty">give the agent any complex task above</div>';
  $("#memLog").innerHTML = '<div class="empty">memory loading…</div>';
  if (state.activeTab !== "mission") state.activeTab = "browse";
  // Health probe every 15s but only flips to "offline" after 3 fails.
  setInterval(refreshConn, 15000);
})();
