// Where the panel gets its data. Owner: Tanishq.
// The panel (popup.js) only ever calls source.scan() and source.analyze().
// In mock mode they read mockData.js. In real mode they message background.js.
// Switching between the two is one flag in utils/config.js.

import { USE_MOCK } from "../utils/config.js";
import { MSG } from "../utils/messages.js";
import { getScenario, getError, MOCK_POLICY_ANALYSIS } from "../mockData.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (code, message) => ({ error: true, code, message });

function withTimeout(promise, ms, code, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(fail(code, message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* ---------- mock ---------- */

const mock = { scenario: "highRisk", analyzeFails: false };
export const setMockScenario = (name) => { mock.scenario = name; };
export const setMockAnalyzeFails = (value) => { mock.analyzeFails = value; };

const mockSource = {
    async scan() {
        await wait(900); // so the scanning state is visible
        if (mock.scenario.startsWith("error:")) throw getError(mock.scenario.slice(6));
        return getScenario(mock.scenario);
    },
    async analyze() {
        await wait(1200);
        if (mock.analyzeFails) throw getError("geminiFailed");
        return structuredClone(MOCK_POLICY_ANALYSIS);
    }
};

/* ---------- real (background.js) ----------
   background.js replies to the message with the finished report (scan) or the
   policy analysis (analyze), or with an error object { error: true, code, message }. */

async function ask(message) {
    let reply;
    try {
        reply = await chrome.runtime.sendMessage(message);
    } catch {
        throw fail("UNKNOWN", "Could not reach PrivacyGuard's background process. Reload the extension and try again.");
    }
    if (!reply) throw fail("UNKNOWN", "No response from PrivacyGuard's background process.");
    if (reply.error) throw reply;
    return reply;
}

const realSource = {
    scan: (tabId) =>
        withTimeout(ask({ type: MSG.START_SCAN, payload: { tabId } }), 30000,
            "SCAN_TIMEOUT", "The scan did not finish in time."),
    analyze: (tabId, policyUrl) =>
        withTimeout(ask({ type: MSG.ANALYZE_POLICY, payload: { tabId, policyUrl } }), 60000,
            "GEMINI_FAILED", "The policy analysis did not finish in time.")
};

export const source = USE_MOCK ? mockSource : realSource;