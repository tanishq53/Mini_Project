// PrivacyGuard background service worker. Owner: Tanishq.
// START_SCAN -> ask the page's content scripts -> add cookies -> POST /scan -> report.
import { postScan } from "../utils/api.js";
import { SCAN_TIMEOUT_MS } from "../utils/config.js";

const ZERO_SCANNER = {
  forms: 0, personalDataFields: 0,
  fieldTypes: { name: 0, email: 0, phone: 0, address: 0, dob: 0, password: 0, financial: 0, governmentId: 0 },
  fields: []
};
const ZERO_TRACKING = {
  thirdPartyScripts: 0,
  trackers: { analytics: 0, advertising: 0, social: 0, unknown: 0 },
  trackerList: []
};
const ZERO_POLICY = { found: false, url: null, candidates: [] };

// tabId -> { scanner, tracker, resolve }. Content scripts answer with SCAN_RESULT,
// and sender.tab.id tells us which scan the answer belongs to.
const pending = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("PrivacyGuard: side panel setup failed", err));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ ok: true });
  } else if (message.type === "SCAN_RESULT" && sender.tab) {
    collect(sender.tab.id, message.payload);
  } else if (message.type === "START_SCAN") {
    runScan(message.payload && message.payload.tabId).then(sendResponse);
    return true; // keep the channel open for the async reply
  }
});

function collect(tabId, { source, data }) {
  const job = pending.get(tabId);
  if (!job) return;
  job[source] = data;
  if (job.scanner && job.tracker) job.resolve();
}

async function runScan(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return fail("RESTRICTED_PAGE", "Could not find that tab.");
  }
  if (!/^https?:/.test(tab.url || "")) {
    return fail("RESTRICTED_PAGE", "PrivacyGuard can only scan normal http and https pages.", tabId);
  }
  notify({ type: "SCAN_STARTED", payload: { tabId, url: tab.url } });

  const warnings = [];
  const parts = await askContentScripts(tabId);
  if (!parts.scanner) warnings.push("The form scanner did not respond. Personal data was not checked.");
  if (!parts.tracker) warnings.push("The tracker scanner did not respond. Trackers were not checked.");

  const trackerData = parts.tracker || { tracking: ZERO_TRACKING, policy: ZERO_POLICY };
  const url = new URL(tab.url);
  const scan = {
    url: tab.url,
    hostname: url.hostname,
    scannedAt: new Date().toISOString(),
    https: url.protocol === "https:",
    scanner: parts.scanner || ZERO_SCANNER,
    tracking: {
      cookies: await countCookies(url.hostname, trackerData.tracking.trackerList || []),
      thirdPartyScripts: trackerData.tracking.thirdPartyScripts,
      trackers: trackerData.tracking.trackers
    },
    policy: trackerData.policy || ZERO_POLICY
  };

  try {
    const result = await postScan(scan);
    const report = { scan, result, policyAnalysis: null, warnings };
    notify({ type: "REPORT_READY", payload: { tabId, report } });
    return report;
  } catch (error) {
    return fail(error.code, error.message, tabId);
  }
}

// Sends RUN_SCAN and waits for both content scripts, or the timeout.
async function askContentScripts(tabId) {
  const job = { scanner: null, tracker: null };
  const done = new Promise((resolve) => { job.resolve = resolve; });
  pending.set(tabId, job);

  try {
    await chrome.tabs.sendMessage(tabId, { type: "RUN_SCAN" });
  } catch {
    // Tab was open before the extension loaded: inject the scripts, then retry once.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/policyDetector.js", "content/scanner.js", "content/tracker.js"]
      });
      await chrome.tabs.sendMessage(tabId, { type: "RUN_SCAN" });
    } catch (err) {
      console.warn("PrivacyGuard: could not reach the page", err);
    }
  }
  // A silent module must never block the scan (contract: timeout, then zero-fill).
  await Promise.race([done, new Promise((r) => setTimeout(r, SCAN_TIMEOUT_MS))]);
  pending.delete(tabId);
  return { scanner: job.scanner, tracker: job.tracker };
}

// Content scripts cannot read cookies, so we count them here.
// First party = cookies of the page's site. Third party = cookies of the tracker domains found.
// The "last two labels" rule is a simplification (it mishandles co.uk style domains).
const siteOf = (host) => host.replace(/^\./, "").split(".").slice(-2).join(".");

async function countCookies(hostname, trackerList) {
  const site = siteOf(hostname);
  const key = (c) => `${c.domain}|${c.name}|${c.path}`;
  try {
    const first = new Set((await chrome.cookies.getAll({ domain: site })).map(key));
    const third = new Set();
    const domains = new Set(trackerList.map((t) => t.domain).filter((d) => siteOf(d) !== site));
    for (const d of domains) {
      for (const c of await chrome.cookies.getAll({ domain: d })) third.add(key(c));
    }
    return { total: first.size + third.size, firstParty: first.size, thirdParty: third.size };
  } catch (err) {
    console.warn("PrivacyGuard: cookie read failed", err);
    return { total: 0, firstParty: 0, thirdParty: 0 };
  }
}

function fail(code, message, tabId) {
  const error = { error: true, code, message };
  notify({ type: "SCAN_ERROR", payload: { tabId, error } });
  return error;
}

// The panel may be closed; sendMessage then rejects, which is fine.
function notify(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}