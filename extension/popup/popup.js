// PrivacyGuard side panel controller. Owner: Tanishq.
// Decides what the user sees: idle -> scanning -> result or error.
// Rendering lives in ui.js. Data comes from source.js (mock or real).

import { USE_MOCK } from "../utils/config.js";
import {
    showState, setScanningSite, renderReport, renderPolicyAnalysis,
    renderWarnings, addWarning, setAnalyzeButton, renderError, errorCopy
} from "./ui.js";
import { source } from "./source.js";
import { mountDevPicker } from "./devPicker.js";

const $ = (id) => document.getElementById(id);

let report = null;   // the report currently on screen
let tab = null;      // the tab being scanned
let busy = false;    // true while a scan or analysis is running

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

/* ---------- actions ---------- */

async function startScan() {
    if (busy) return;
    busy = true;
    try {
        tab = await getActiveTab();
        setScanningSite(hostOf(tab?.url));
        showState("scanning");

        if (!USE_MOCK && isRestricted(tab?.url)) {
            throw { error: true, code: "RESTRICTED_PAGE" };
        }

        report = await source.scan(tab?.id);
        renderReport(report);
        showState("result");
        window.scrollTo(0, 0);
    } catch (err) {
        report = null;
        renderError(toError(err));
    } finally {
        busy = false;
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

if (USE_MOCK) mountDevPicker();

// The panel stays open when the user changes tab or the page finishes loading.
// Showing the old site's results would be misleading, so go back to the start screen.
// (Step 10 replaces this with automatic rescans.)
if (!USE_MOCK) {
    const reset = () => {
        if (busy) return;
        report = null;
        showState("idle");
    };
    chrome.tabs.onActivated.addListener(reset);
    chrome.tabs.onUpdated.addListener((tabId, info, changed) => {
        if (info.status === "complete" && changed.active) reset();
    });
}

showState("idle");