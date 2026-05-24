// Content script — runs on DelOS main app pages. Pushes settings + tenant + mcp into extension storage.
// Sets a documentElement attribute so the page (different isolated world) can detect the ext.

(function () {
  if (window.__delrioSyncInstalled) return;
  window.__delrioSyncInstalled = true;

  // Cross-world signal: page-context JS can read documentElement attrs even though it cannot
  // see content-script `window` globals. Used by /extension banner + auto-detect logic.
  try {
    document.documentElement.setAttribute("data-delos-ext", "linked");
    document.documentElement.setAttribute("data-delos-ext-version", "2.1.1");
  } catch {}

  function readLS(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function snapshot() {
    return {
      tenantId: localStorage.getItem("delos.tenantId.v1") || null,
      modelOverrides: readLS("delos.modelOverrides.v1") || {},
      mcpServers: readLS("delos.mcpServers.v1") || [],
    };
  }

  function push() {
    const payload = snapshot();
    try {
      chrome.runtime.sendMessage({ kind: "delrio-sync", payload }, () => {
        // Ignore lastError if extension reloaded
        void chrome.runtime.lastError;
      });
    } catch {}
  }

  // Initial sync
  push();

  // Re-sync on the change events DelOS dispatches
  window.addEventListener("delos-models-changed", push);
  window.addEventListener("delos-mcp-changed", push);

  // Polling fallback every 5s in case events don't fire
  setInterval(push, 5000);

  // Persistent badge so user always sees the ext is connected.
  // Renders once DOM is ready; fades to low-opacity after 4s so it doesn't distract.
  function installBadge() {
    if (document.getElementById("__delos_ext_badge")) return;
    const badge = document.createElement("div");
    badge.id = "__delos_ext_badge";
    badge.textContent = "● DelOS ext linked v2.1.1";
    badge.style.cssText =
      "position:fixed;bottom:6px;left:6px;z-index:2147483647;background:rgba(106,176,76,0.22);color:#6ab04c;border:1px solid #6ab04c;font:10px ui-monospace,monospace;padding:3px 8px;letter-spacing:1px;pointer-events:none;transition:opacity 600ms;";
    document.body.appendChild(badge);
    setTimeout(() => { badge.style.opacity = "0.35"; }, 4000);
  }
  if (document.body) installBadge();
  else document.addEventListener("DOMContentLoaded", installBadge);
})();
