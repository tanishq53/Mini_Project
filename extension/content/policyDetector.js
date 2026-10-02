// Owner: Namitha. Stub: returns "not found" in the contract format (docs/contract.md 4.2).
// Content scripts share one global scope, so tracker.js can call window.__pgDetectPolicy().
window.__pgDetectPolicy = function () {
  return { found: false, url: null, candidates: [] };
};
