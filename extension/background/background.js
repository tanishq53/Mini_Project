// PrivacyGuard background service worker. Owner: Tanishq.
// Phase 1: skeleton only. Orchestration (START_SCAN, merging, API calls) comes in Phase 3.

chrome.runtime.onInstalled.addListener(() => {
  // Clicking the toolbar icon opens the side panel.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("PrivacyGuard: side panel setup failed", err));
  console.log("PrivacyGuard installed.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Message types are defined in docs/contract.md section 3.
  console.log("PrivacyGuard background received:", message.type);
  if (message.type === "PING") {
    sendResponse({ ok: true });
  }
});
