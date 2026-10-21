// Owner: Tanishq. Change settings in one place.
export const BACKEND_URL = "http://localhost:8000";
export const SCAN_TIMEOUT_MS = 10000;

// true:  the panel uses mockData.js and shows a dev picker. Works with no backend and no teammates' code.
// false: the panel talks to background.js and the real backend (current setting).
export const USE_MOCK = false;

// Phase 1 covers forms, cookies, trackers and HTTPS only. Set to true in Phase 2 to bring back
// the privacy-policy section, the Analyze policy button and the policy row in the score breakdown.
export const PHASE2_POLICY = false;