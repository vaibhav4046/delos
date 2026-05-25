// DelOS side panel v2.2 — autonomous voice tab agent.
//
// Voice flow (when "autonomous" is checked):
//   1. Web Speech API → final transcript.
//   2. POST /api/voice-command → { intent, app, payload, reply }.
//   3. Map intent → tab action via background.js RPC, or fall back to
//      /api/quick-agent for free-text answers.
//   4. TTS the reply, then (if "loop" is checked) reopen the mic.
//
// Intents we handle natively against the active tab (no /api/run trip):
//   read_tab / summarize_tab / click / fill / scroll / open_url /
//   navigate / open_tab / close_tab / reload / back / forward / links
//
// Everything else still falls through to /api/quick-agent so the agent
// can answer general questions ("what time is it in Tokyo").

// MODELS list trimmed to 7 verified-connected providers · 2026-05-25 audit.
// Dropped: gemini-2.5-pro (latency), llama-4-scout (redundant w/ maverick),
// mistral-small (NIM Nemotron replaces). Added NIM Nemotron + Llama-3.3-70b.
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
  voiceRec: null,
  voiceLoop: false,
  voiceBusy: false,
  voiceAuto: true,
  activeTab: "voice",
  runBase: Date.now(),
};

// ───────────────────────── storage / sync ─────────────────────────
async function loadCfg() {
  const stored = await chrome.storage.local.get(["endpoint", "tenantId", "modelOverrides", "mcpServers", "syncedFrom"]);
  state.cfg.endpoint = stored.endpoint || DEFAULTS.endpoint;
  state.cfg.tenantId = stored.tenantId || "";
  state.cfg.modelOverrides = stored.modelOverrides || {};
  state.cfg.mcpServers = stored.mcpServers || [];
  state.cfg.syncedFrom = stored.syncedFrom || null;
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
    if (changes.tenantId || changes.mcpServers) {
      $("#syncedFrom").textContent = `synced · ${new Date().toLocaleTimeString()}`;
    }
  }
});

// ───────────────────────── connection ────────────────────────────
async function refreshConn() {
  const pill = $("#conn");
  pill.className = "pill pill-warn";
  pill.textContent = "● checking";
  try {
    const r = await fetch(`${state.cfg.endpoint}/api/health`, { method: "GET" });
    if (r.ok) {
      pill.className = "pill pill-ok";
      pill.textContent = "● connected";
    } else {
      pill.className = "pill pill-bad";
      pill.textContent = `● ${r.status}`;
    }
  } catch {
    pill.className = "pill pill-bad";
    pill.textContent = "● offline";
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
  }),
);

// ───────────────────────── settings ──────────────────────────────
function renderSettings() {
  $("#cfgEndpoint").value = state.cfg.endpoint;
  $("#cfgTenant").value = state.cfg.tenantId || "";
  for (const role of ["planner", "executor", "critic"]) {
    const sel = $(`#cfg${role.charAt(0).toUpperCase() + role.slice(1)}`);
    sel.innerHTML = '<option value="">(default)</option>' + MODELS.map((m) => `<option value="${m}">${m}</option>`).join("");
    sel.value = state.cfg.modelOverrides[role] || "";
  }
}
$("#settingsBtn").addEventListener("click", () => $("#settingsModal").classList.remove("hidden"));
$("#settingsClose").addEventListener("click", () => $("#settingsModal").classList.add("hidden"));
$("#cfgSave").addEventListener("click", async () => {
  state.cfg.endpoint = $("#cfgEndpoint").value.trim() || DEFAULTS.endpoint;
  state.cfg.tenantId = $("#cfgTenant").value.trim();
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
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function appendLog(targetId, html) {
  const el = $(`#${targetId}`);
  if (el.firstChild?.classList?.contains("empty")) el.innerHTML = "";
  const div = document.createElement("div");
  div.className = "line";
  div.innerHTML = html;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}
function setStats(s) {
  const el = $("#stats");
  el.innerHTML = ["tok in", "tok out", "calls", "ms"]
    .map((k, i) => `<div class="stat"><div class="v">${s[i] ?? 0}</div><div class="k">${k}</div></div>`)
    .join("") + `<div class="stat"><div class="v">${s[4] ?? "·"}</div><div class="k">cost</div></div>`;
}

function setVoiceStatus(kind, label, meta = "") {
  const el = $("#voiceStatus");
  el.className = `voice-status ${kind}`;
  $("#voiceStatusLabel").textContent = label;
  $("#voiceStatusMeta").textContent = meta;
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
    case "error":
      return `${muted(t)} ${tag("bad", "ERR")} ${esc(ev.message)}`;
  }
  return "";
}

// ───────────────────────── mission run (kept) ────────────────────
const runStats = { pin: 0, pout: 0, calls: 0, llmMs: 0 };

$("#runBtn").addEventListener("click", run);
$("#stopBtn").addEventListener("click", () => state.runCtrl?.abort());
$("#steerBtn").addEventListener("click", sendSteer);
$("#grabTab").addEventListener("click", grabTabContext);
$("#micBtn").addEventListener("click", () => toggleSttIntoGoal());

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
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
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
        } catch {}
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") appendLog("log", `${tag("bad", "ERR")} ${esc(e.message)}`);
  } finally {
    $("#steerRow").classList.add("hidden");
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

// ───────────────────────── analyze tab (X1) ──────────────────────
$("#analyzeTabBtn")?.addEventListener("click", () => analyzeTab(false));
$("#summarizeTabBtn")?.addEventListener("click", () => analyzeTab(true));

async function analyzeTab(summarize) {
  appendLog("voiceLog", `${tag("info", "tab")} ${summarize ? "summarizing" : "analyzing"}…`);
  const tabRes = await tabAction("read");
  if (!tabRes?.ok) {
    appendLog("voiceLog", `${tag("bad", "ERR")} ${esc(tabRes?.error || "read failed")}`);
    return;
  }
  const data = tabRes.data;
  appendLog("voiceLog", `<div class="muted">${esc(data.title || "(no title)")} · ${esc(data.url)}</div>`);
  const prompt = summarize
    ? `Summarize this web page in 4-6 concise bullets. Be specific, no filler.\n\nTITLE: ${data.title}\nURL: ${data.url}\n\nPAGE TEXT:\n${(data.text || "").slice(0, 6000)}`
    : `Analyze this web page. Identify the main topic, key claims, source quality, and any action items.\n\nTITLE: ${data.title}\nURL: ${data.url}\n\nPAGE TEXT:\n${(data.text || "").slice(0, 6000)}`;
  try {
    const r = await fetch(`${state.cfg.endpoint}/api/quick-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: prompt, tenantId: state.cfg.tenantId }),
    });
    const j = await r.json();
    appendLog("voiceLog", `<div class="answer">${tag("info", summarize ? "summary" : "analysis")} ${esc(j.text || j.error || "(no result)")}</div>`);
    if ($("#voiceSpeak")?.checked && j.text) speakText(j.text);
  } catch (e) {
    appendLog("voiceLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
  }
}

// ───────────────────────── browse agent (X2) ─────────────────────
$("#browseRunBtn")?.addEventListener("click", runBrowseAgent);
let browseStop = false;
$("#browseStopBtn")?.addEventListener("click", () => { browseStop = true; });

async function runBrowseAgent() {
  const task = $("#browseTask").value.trim();
  if (!task) {
    appendLog("browseLog", `${tag("bad", "ERR")} task required`);
    return;
  }
  $("#browseLog").innerHTML = "";
  browseStop = false;
  appendLog("browseLog", `${tag("info", "task")} ${esc(task)}`);

  // Gather current tab context if checkbox checked
  let tabContext = null;
  if ($("#browseUseTab")?.checked) {
    const r = await tabAction("read");
    if (r?.ok) {
      tabContext = { url: r.data.url, title: r.data.title, text: r.data.text, selection: r.data.selection };
      appendLog("browseLog", `${tag("muted", "ctx")} ${esc(r.data.title || r.data.url)}`);
    }
  }

  // Get plan from /api/browse-agent
  appendLog("browseLog", `${tag("info", "plan")} requesting…`);
  let plan;
  try {
    const r = await fetch(`${state.cfg.endpoint}/api/browse-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, tabContext, tenantId: state.cfg.tenantId }),
    });
    const j = await r.json();
    if (!r.ok || !j.plan) {
      appendLog("browseLog", `${tag("bad", "ERR")} ${esc(j.error || "no plan")}`);
      return;
    }
    plan = j.plan;
    appendLog("browseLog", `${tag("ok", "plan")} ${plan.length} steps · ${esc(j.planner || "")}`);
    if (j.final) appendLog("browseLog", `<div class="muted">${esc(j.final)}</div>`);
  } catch (e) {
    appendLog("browseLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
    return;
  }

  // Execute each step against active tab
  for (let i = 0; i < plan.length; i++) {
    if (browseStop) {
      appendLog("browseLog", `${tag("warn", "stopped")} by user`);
      break;
    }
    const step = plan[i];
    const label = `${i + 1}/${plan.length}`;
    appendLog("browseLog", `${tag(step.tier === "destructive" ? "bad" : step.tier === "external" ? "warn" : "info", label)} ${esc(step.action)} ${esc(JSON.stringify(step.args).slice(0, 120))}`);

    // Gate destructive + external
    if (step.tier === "destructive" || step.tier === "external") {
      const ok = confirm(`Approve ${step.tier} step ${label}:\n${step.action} ${JSON.stringify(step.args)}`);
      if (!ok) {
        appendLog("browseLog", `${tag("warn", "skip")} user denied`);
        continue;
      }
    }

    try {
      let result;
      if (step.action === "answer") {
        appendLog("browseLog", `<div class="answer">${tag("info", "answer")} ${esc(step.args.text || "")}</div>`);
        if ($("#browseSpeak")?.checked && step.args.text) speakText(step.args.text);
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
        result = j.text || j.error || "(no result)";
        appendLog("browseLog", `<div class="answer">${tag("ok", step.action)} ${esc(result)}</div>`);
        if ($("#browseSpeak")?.checked) speakText(result);
        continue;
      }
      // Map action → tabAction
      const map = {
        navigate: ["navigate", { url: step.args.url }],
        scroll: ["scroll", { direction: step.args.direction || "down", amount: step.args.amount || 800 }],
        click: ["click", { needle: step.args.needle }],
        fill: ["fill", { field: step.args.field, value: step.args.value }],
        read: ["read", {}],
        links: ["links", { limit: step.args.limit || 20 }],
      };
      const [act, args] = map[step.action] || [step.action, step.args];
      result = await tabAction(act, args);
      if (result?.ok) {
        appendLog("browseLog", `${tag("ok", "✓")} ${esc(JSON.stringify(result.data || {}).slice(0, 160))}`);
      } else {
        appendLog("browseLog", `${tag("bad", "✗")} ${esc(result?.error || "failed")}`);
      }
      await new Promise((r) => setTimeout(r, 600));
    } catch (e) {
      appendLog("browseLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
    }
  }
  appendLog("browseLog", `${tag("ok", "done")}`);
}

// ───────────────────────── cohort (kept) ─────────────────────────
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
      body: JSON.stringify({ goal, members }),
    });
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
    chrome.runtime.sendMessage({ kind: "delos-tab-action", action, args }, (res) => resolve(res || { ok: false, error: "no response" }));
  });
}

// ───────────────────────── voice agent (autonomous) ──────────────
function getSttCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

function speakText(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).slice(0, 600));
  u.rate = 1.0;
  u.pitch = 1.0;
  window.speechSynthesis.speak(u);
}

function toggleSttIntoGoal() {
  const Ctor = getSttCtor();
  if (!Ctor) {
    appendLog("log", `${tag("bad", "voice")} SpeechRecognition unsupported`);
    return;
  }
  if (state.miniRec) {
    state.miniRec.stop();
    state.miniRec = null;
    return;
  }
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
    }
    if (final) $("#goal").value = ($("#goal").value + " " + final).trim();
  };
  rec.onend = () => { state.miniRec = null; };
  rec.onerror = () => { state.miniRec = null; };
  rec.start();
  state.miniRec = rec;
}

$("#voiceBtn").addEventListener("click", voiceTurn);
$("#stopSpeakBtn").addEventListener("click", () => window.speechSynthesis?.cancel());

async function voiceTurn() {
  const Ctor = getSttCtor();
  if (!Ctor) {
    appendLog("voiceLog", `${tag("bad", "voice")} unsupported in this browser`);
    return;
  }
  if (state.voiceRec) {
    state.voiceRec.stop();
    return;
  }
  state.voiceLoop = $("#voiceLoop").checked;
  state.voiceAuto = $("#voiceAuto").checked;
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  let live = "", finalText = "";
  setVoiceStatus("listening", "LISTENING…", "speak now");
  $("#voiceBtn").textContent = "■ STOP";
  rec.onresult = (e) => {
    finalText = "";
    live = "";
    for (let i = 0; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else live += e.results[i][0].transcript;
    }
    if (live) setVoiceStatus("listening", "LISTENING…", live.slice(0, 60));
  };
  rec.onend = async () => {
    state.voiceRec = null;
    $("#voiceBtn").textContent = "🎤 HOLD TO TALK";
    const text = (finalText || live).trim();
    if (!text) {
      setVoiceStatus("idle", "READY", "no speech");
      return;
    }
    appendLog("voiceLog", `<b>YOU</b> ${esc(text)}`);
    state.voiceBusy = true;
    setVoiceStatus("thinking", "THINKING", "classifying intent");

    try {
      if (state.voiceAuto) {
        await handleAutonomous(text);
      } else {
        await handleAsk(text);
      }
    } catch (e) {
      appendLog("voiceLog", `${tag("bad", "ERR")} ${esc(e.message)}`);
    } finally {
      state.voiceBusy = false;
      setVoiceStatus("idle", "READY", state.voiceLoop ? "looping…" : "tap to talk");
      if (state.voiceLoop) setTimeout(voiceTurn, 800);
    }
  };
  rec.onerror = (e) => {
    appendLog("voiceLog", `${tag("bad", "voice")} ${esc(e.error || "error")}`);
    state.voiceRec = null;
    $("#voiceBtn").textContent = "🎤 HOLD TO TALK";
    setVoiceStatus("idle", "READY", "error — retry");
  };
  rec.start();
  state.voiceRec = rec;
}

// Heuristic local intent classifier — runs before /api/voice-command so the
// common cases ("scroll down", "click sign in", "summarize this page",
// "open github") don't burn an LLM call. Returns null if no local match;
// then we fall through to the server classifier.
function localIntent(text) {
  const t = text.trim().toLowerCase();
  // Tab-content reading
  if (/^(read|tell me|what does this page say|read this( (page|tab))?)\b/i.test(t)) {
    return { intent: "read_tab" };
  }
  if (/^(summari[sz]e|sum up|tldr|tl;dr)(\s+(this|the)?\s*(page|tab|article|video|post)?)?/i.test(t)) {
    return { intent: "summarize_tab" };
  }
  // Scrolling
  let m = t.match(/^scroll\s+(up|down|top|bottom)$/);
  if (m) return { intent: "scroll", direction: m[1] };
  if (/^scroll$/.test(t)) return { intent: "scroll", direction: "down" };
  // Click
  m = t.match(/^(click|press|tap)\s+(on\s+)?(.+)$/);
  if (m) return { intent: "click", target: m[3].replace(/\.$/, "") };
  // Fill
  m = t.match(/^(fill|type|enter|set)\s+(?:the\s+)?(.+?)\s+(?:with|to|=)\s+(.+)$/);
  if (m) return { intent: "fill", field: m[2], value: m[3] };
  // Navigation
  m = t.match(/^(open|go to|navigate to|visit|launch)\s+(.+)$/);
  if (m) return { intent: "open_url", url: m[2] };
  if (/^reload$|^refresh$/.test(t)) return { intent: "reload" };
  if (/^go back$|^back$/.test(t)) return { intent: "back" };
  if (/^go forward$|^forward$/.test(t)) return { intent: "forward" };
  if (/^close (this )?tab$|^close it$/.test(t)) return { intent: "close_tab" };
  return null;
}

async function handleAutonomous(transcript) {
  // 1) Try local pattern matcher first — fast, free, deterministic.
  let intent = localIntent(transcript);

  // 2) Fall back to server intent classifier for fuzzier inputs.
  if (!intent) {
    try {
      const r = await fetch(`${state.cfg.endpoint}/api/voice-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, tenantId: state.cfg.tenantId || undefined }),
      });
      if (r.ok) {
        const j = await r.json();
        // R5-D · integration_unavailable envelope · open Settings in main app
        // tab + speak the reply rather than silently routing nowhere.
        if (j.kind === "integration_unavailable") {
          const link = `${state.cfg.endpoint}${j.deepLink || "/os"}`;
          appendLog("voiceLog", `${tag("warn", "needs connect")} ${esc(j.provider || "")} · <a href="${esc(link)}" target="_blank" style="color:#7dd3fc;text-decoration:underline">Open Settings</a>`);
          intent = { intent: "answer", reply: j.reply || `${j.provider} not connected — open Settings to connect.` };
        }
        else if (j.kind === "fulfilled") {
          appendLog("voiceLog", `${tag("ok", "✓")} ${esc(j.provider || "")} · ${esc(j.action || "")}`);
          intent = { intent: "answer", reply: j.reply || "ok" };
        }
        else if (j.kind === "integration_call") {
          // Direct provider call · trust server's reply text
          intent = { intent: "answer", reply: j.reply || "dispatched" };
        }
        // Bridge server intent vocabulary → our tab-action vocabulary.
        else if (j.intent === "open_app" && j.app) intent = { intent: "open_url", url: j.app };
        else if (j.intent === "navigate" && j.payload) intent = { intent: "open_url", url: j.payload };
        else if (j.intent === "answer") intent = { intent: "answer", reply: j.reply };
        else intent = { intent: "answer", reply: j.reply || "ok" };
      }
    } catch {}
  }
  if (!intent) intent = { intent: "ask" };

  setVoiceStatus("acting", intent.intent.toUpperCase(), "");

  // 3) Execute the intent against the current tab or the agent.
  switch (intent.intent) {
    case "read_tab": {
      const res = await tabAction("read");
      const text = res?.data?.text?.slice(0, 240) || "(no text)";
      appendLog("voiceLog", `${tag("cyan", "read")} ${esc(text)}…`);
      speakText(text);
      break;
    }
    case "summarize_tab": {
      const res = await tabAction("read");
      if (!res?.ok) { speakText("Could not read the page."); break; }
      const ctx = res.data;
      const r = await fetch(`${state.cfg.endpoint}/api/quick-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Summarize this web page in 3 short bullets.\n\nTitle: ${ctx.title}\nURL: ${ctx.url}\n\n${ctx.text}`,
          models: state.cfg.modelOverrides,
          tenantId: state.cfg.tenantId || undefined,
        }),
      });
      const j = await r.json();
      const reply = j.text || `err: ${j.error || "unknown"}`;
      appendLog("voiceLog", `<div class="answer">${tag("info", "summary")} ${esc(reply)}</div>`);
      if ($("#voiceSpeak").checked) speakText(reply);
      break;
    }
    case "click": {
      const res = await tabAction("click", { needle: intent.target });
      const ok = res?.data?.ok;
      appendLog("voiceLog", `${tag(ok ? "ok" : "bad", "click")} ${esc(intent.target)} ${ok ? "✓" : ""}`);
      if ($("#voiceSpeak").checked) speakText(ok ? `Clicked ${intent.target}.` : `Could not find ${intent.target}.`);
      break;
    }
    case "fill": {
      const res = await tabAction("fill", { field: intent.field, value: intent.value });
      const ok = res?.data?.ok;
      appendLog("voiceLog", `${tag(ok ? "ok" : "bad", "fill")} ${esc(intent.field)} = ${esc(intent.value)} ${ok ? "✓" : ""}`);
      if ($("#voiceSpeak").checked) speakText(ok ? `Filled ${intent.field}.` : `Could not find a ${intent.field} field.`);
      break;
    }
    case "scroll": {
      await tabAction("scroll", { direction: intent.direction || "down" });
      appendLog("voiceLog", `${tag("info", "scroll")} ${esc(intent.direction || "down")}`);
      break;
    }
    case "open_url": {
      await tabAction("navigate", { url: intent.url });
      appendLog("voiceLog", `${tag("info", "→")} ${esc(intent.url)}`);
      if ($("#voiceSpeak").checked) speakText(`Opening ${intent.url}.`);
      break;
    }
    case "reload":
    case "back":
    case "forward":
    case "close_tab": {
      await tabAction(intent.intent);
      appendLog("voiceLog", `${tag("info", intent.intent)} ✓`);
      break;
    }
    case "answer": {
      const reply = intent.reply || "ok";
      appendLog("voiceLog", `<div class="answer">${tag("info", "agent")} ${esc(reply)}</div>`);
      if ($("#voiceSpeak").checked) speakText(reply);
      break;
    }
    case "ask":
    default: {
      await handleAsk(transcript);
      break;
    }
  }
}

async function handleAsk(transcript) {
  const r = await fetch(`${state.cfg.endpoint}/api/quick-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: transcript, models: state.cfg.modelOverrides, tenantId: state.cfg.tenantId || undefined }),
  });
  const j = await r.json();
  const reply = j.text || `err: ${j.error || "unknown"}`;
  appendLog("voiceLog", `<div class="answer">${tag("info", "agent")} ${esc(reply)}</div>`);
  if ($("#voiceSpeak").checked) speakText(reply);
}

// ───────────────────────── memory (kept) ─────────────────────────
$("#memBtn").addEventListener("click", recallMem);

async function recallMem() {
  const q = $("#memQuery").value.trim() || "recent agent runs";
  $("#memLog").innerHTML = "";
  try {
    const url = `${state.cfg.endpoint}/api/memory?q=${encodeURIComponent(q)}&topK=12`;
    const r = await fetch(url);
    const j = await r.json();
    if (j.hits?.length === 0 && j.local?.length === 0) {
      appendLog("memLog", `<span class="empty">no matches</span>`);
      return;
    }
    for (const h of j.hits || []) {
      appendLog("memLog", `${tag("info", "hit")} ${tag("muted", "s=" + (h.score?.toFixed(2) ?? "?"))} ${esc(h.text)}`);
    }
    for (const m of j.local || []) {
      const tags = (m.tags || []).map((t) => tag("muted", t)).join("");
      appendLog("memLog", `${tag("warn", "local")} ${tags} ${esc(m.text)}`);
    }
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
    // If a selection-context-menu drop arrived, jump to Mission tab.
    $$(".tab").forEach((x) => x.classList.remove("on"));
    $$(".panel").forEach((x) => x.classList.remove("on"));
    $('[data-tab="mission"]')?.classList.add("on");
    $('[data-panel="mission"]')?.classList.add("on");
    state.activeTab = "mission";
  }
  $("#log").innerHTML = '<div class="empty">terminal ready <span class="cursor"></span></div>';
  $("#cohortResults").innerHTML = '<div class="empty">no cohort run yet</div>';
  $("#voiceLog").innerHTML = '<div class="empty">tap the mic, say "summarize this page"</div>';
  $("#memLog").innerHTML = '<div class="empty">search saved runs</div>';
  setVoiceStatus("idle", "READY", "autonomous mode");
  setInterval(refreshConn, 15000);
})();
