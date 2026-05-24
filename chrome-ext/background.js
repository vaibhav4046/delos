// Service worker — open side panel on toolbar click, register context menus, route messages.

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Content script may push tenant/model sync from main app
  if (msg?.kind === "delrio-sync") {
    const payload = msg.payload || {};
    const updates = {};
    if (typeof payload.tenantId === "string") updates.tenantId = payload.tenantId;
    if (payload.modelOverrides) updates.modelOverrides = payload.modelOverrides;
    if (payload.mcpServers) updates.mcpServers = payload.mcpServers;
    if (Object.keys(updates).length) {
      chrome.storage.local.set(updates).then(() => sendResponse({ ok: true }));
      return true;
    }
  }
  // Side panel may ask for current page text
  if (msg?.kind === "delrio-grab-tab") {
    chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([t]) => {
        if (!t?.id) {
          sendResponse({ error: "no active tab" });
          return;
        }
        chrome.scripting
          .executeScript({
            target: { tabId: t.id },
            func: () => {
              const sel = window.getSelection()?.toString() ?? "";
              const text = sel || document.body.innerText.slice(0, 4000);
              return { url: location.href, title: document.title, text };
            },
          })
          .then((res) => sendResponse({ data: res[0]?.result }))
          .catch((e) => sendResponse({ error: String(e) }));
      });
    return true;
  }
});
