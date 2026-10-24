// PrivacyGuard side panel controller. Owner: Tanishq.
// Decides what the user sees: idle -> scanning -> result or error.
// Rendering lives in ui.js. Data comes from source.js (mock or real).

import { USE_MOCK } from "../utils/config.js";
import {
    showState, setScanningSite, renderReport, renderPolicyAnalysis,
    renderWarnings, addWarning, setAnalyzeButton, renderError, errorCopy,
    applyPhaseSwitch, renderReputation
} from "./ui.js";
import { source } from "./source.js";
import { mountDevPicker } from "./devPicker.js";
import { getReport } from "../utils/storage.js";

const $ = (id) => document.getElementById(id);

let report = null;   // the report currently on screen
let tab = null;      // the tab being scanned
let busy = false;    // true while a scan or analysis is running
let rescanQueued = false; // the page changed while a scan was running
let timer = null;    // debounce for automatic scans
let reputationRequestId = 0;

/* ---------- helpers ---------- */

async function getActiveTab() {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return active ?? null;
}

function hostOf(url) {
    try { return new URL(url).hostname; } catch { return ""; }
}

// Pages where Chrome does not allow extensions to run.
function isRestricted(url) {
    return !url || !/^https?:/.test(url) ||
        url.startsWith("https://chromewebstore.google.com") ||
        url.startsWith("https://chrome.google.com/webstore");
}

function toError(err) {
    return err?.code ? err : { error: true, code: "UNKNOWN", message: err?.message };
}

const smooth = () => (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

async function checkReputation(targetReport, targetTabId) {
    const requestId = ++reputationRequestId;
    renderReputation({ status: "checking" });
    try {
        const result = await chrome.runtime.sendMessage({
            type: "CHECK_REPUTATION",
            payload: { url: targetReport.scan.url }
        });
        if (requestId !== reputationRequestId || report !== targetReport || tab?.id !== targetTabId) return;
        renderReputation(result);
    } catch (err) {
        console.warn("PrivacyGuard: could not display site reputation", err);
        if (requestId === reputationRequestId && report === targetReport && tab?.id === targetTabId) {
            renderReputation({ status: "unavailable" });
        }
    }
}

/* ---------- actions ---------- */

// Real mode: background.js runs the scan and calls the backend (contract: START_SCAN).
async function scanReal(tabId) {
    const reply = await chrome.runtime.sendMessage({ type: "START_SCAN", payload: { tabId } });
    if (!reply || reply.error) throw reply ?? { error: true, code: "SCAN_TIMEOUT" };
    return reply;
}

async function startScan() {
    if (busy) { rescanQueued = true; return; }
    busy = true;
    try {
        tab = await getActiveTab();
        setScanningSite(hostOf(tab?.url));
        showState("scanning");

        // Show this tab's last result while the fresh scan runs.
        if (!USE_MOCK && tab?.id != null) {
            const cached = await getReport(tab.id);
            if (cached) {
                report = cached;
                renderReport(cached);
                showState("result");
                checkReputation(cached, tab.id);
            }
        }

        if (!USE_MOCK && isRestricted(tab?.url)) {
            throw { error: true, code: "RESTRICTED_PAGE" };
        }

        report = USE_MOCK ? await source.scan(tab?.id) : await scanReal(tab?.id);
        renderReport(report);
        showState("result");
        if (!USE_MOCK && tab?.id != null) checkReputation(report, tab.id);
        else renderReputation({ status: "mock" });
        window.scrollTo(0, 0);
    } catch (err) {
        report = null;
        renderError(toError(err));
    } finally {
        busy = false;
        // The user moved on while we were scanning: scan the new page instead of showing stale data.
        if (rescanQueued) { rescanQueued = false; startScan(); }
    }
}

async function analyzePolicy() {
    if (busy || !report?.scan?.policy?.found) return;
    busy = true;
    setAnalyzeButton("loading");
    try {
        const analysis = await source.analyze(tab?.id, report.scan.policy.url);
        report.policyAnalysis = analysis;
        renderWarnings(report.warnings);
        renderPolicyAnalysis(analysis);
        setAnalyzeButton("done");
        $("policy-analysis").scrollIntoView({ behavior: smooth(), block: "start" });
    } catch (err) {
        // The score is still valid, so a failed analysis is a warning, not a full error screen.
        const { title, message } = errorCopy(toError(err).code, toError(err).message);
        renderWarnings(report.warnings);
        addWarning(`${title}. ${message}`);
        setAnalyzeButton("ready");
    } finally {
        busy = false;
    }
}

/* ---------- wiring ---------- */

$("btn-scan").addEventListener("click", startScan);
$("btn-rescan").addEventListener("click", startScan);
$("btn-retry").addEventListener("click", startScan);
$("btn-analyze").addEventListener("click", analyzePolicy);

applyPhaseSwitch();
if (USE_MOCK) mountDevPicker();

// Automatic scanning: when the panel opens, when the user switches tab, and when a page finishes loading.
// The short delay merges bursts of events (a page load often fires several) into one scan.
if (!USE_MOCK) {
    const scheduleScan = () => {
        clearTimeout(timer);
        timer = setTimeout(startScan, 400);
    };
    chrome.tabs.onActivated.addListener(scheduleScan);
    chrome.tabs.onUpdated.addListener((tabId, info, changedTab) => {
        if (info.status === "complete" && changedTab.active) scheduleScan();
    });
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type !== "REPORT_READY" || message.payload?.tabId !== tab?.id || busy) return;
        report = message.payload.report;
        renderReport(report);
        showState("result");
        if (tab?.id != null) checkReputation(report, tab.id);
    });
    startScan();
} else {
    showState("idle");
}
