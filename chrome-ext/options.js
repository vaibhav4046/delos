const MODELS = [
  "groq:openai/gpt-oss-120b",
  "groq:openai/gpt-oss-20b",
  "groq:meta-llama/llama-4-scout-17b-16e-instruct",
  "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
  "groq:moonshotai/kimi-k2-instruct-0905",
  "mistral:mistral-large-latest",
  "mistral:mistral-small-latest",
  "google:gemini-2.5-flash",
  "google:gemini-2.5-pro",
];

const $ = (s) => document.querySelector(s);

function fillSelect(id, val) {
  const sel = $(id);
  sel.innerHTML = '<option value="">(default)</option>' + MODELS.map((m) => `<option value="${m}">${m}</option>`).join("");
  if (val) sel.value = val;
}

async function load() {
  const s = await chrome.storage.local.get(["endpoint", "tenantId", "modelOverrides"]);
  $("#endpoint").value = s.endpoint || "https://delrio.vercel.app";
  $("#tenant").value = s.tenantId || "";
  const ov = s.modelOverrides || {};
  fillSelect("#planner", ov.planner);
  fillSelect("#executor", ov.executor);
  fillSelect("#critic", ov.critic);
}

$("#save").addEventListener("click", async () => {
  const ov = {};
  for (const role of ["planner", "executor", "critic"]) {
    const v = $(`#${role}`).value;
    if (v) ov[role] = v;
  }
  await chrome.storage.local.set({
    endpoint: $("#endpoint").value.trim() || "https://delrio.vercel.app",
    tenantId: $("#tenant").value.trim(),
    modelOverrides: ov,
  });
  $("#status").textContent = "saved · " + new Date().toLocaleTimeString();
});

$("#reset").addEventListener("click", async () => {
  await chrome.storage.local.remove(["endpoint", "tenantId", "modelOverrides", "mcpServers"]);
  await load();
  $("#status").textContent = "reset";
});

load();
