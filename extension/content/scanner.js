// Owner: Varsha. Stub: returns zeros in the contract format (docs/contract.md 4.1).
// Never read what the user typed. Detect field types from attributes only.
(() => {
  function scanPage() {
    return {
      forms: 0,
      personalDataFields: 0,
      fieldTypes: {
        name: 0, email: 0, phone: 0, address: 0,
        dob: 0, password: 0, financial: 0, governmentId: 0
      },
      fields: []
    };
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "RUN_SCAN") {
      chrome.runtime.sendMessage({
        type: "SCAN_RESULT",
        payload: { source: "scanner", data: scanPage() }
      });
    }
  });
})();
