// Owner: Namitha. Stub: returns zeros in the contract format (docs/contract.md 4.2).
// Cookies are NOT read here. background.js reads them with chrome.cookies.
(() => {
  function scanTracking() {
    return {
      tracking: {
        thirdPartyScripts: 0,
        trackers: { analytics: 0, advertising: 0, social: 0, unknown: 0 },
        trackerList: []
      },
      policy: window.__pgDetectPolicy
        ? window.__pgDetectPolicy()
        : { found: false, url: null, candidates: [] }
    };
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "RUN_SCAN") {
      chrome.runtime.sendMessage({
        type: "SCAN_RESULT",
        payload: { source: "tracker", data: scanTracking() }
      });
    }
  });
})();
