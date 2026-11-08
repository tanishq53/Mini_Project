// PrivacyGuard side panel controller. Owner: Tanishq.
// Decides what the user sees: idle -> scanning -> result or error.
// Rendering lives in ui.js. Data comes from source.js (mock or real).

import { USE_MOCK } from "../utils/config.js";
import {
    showState, setScanningSite, renderReport, renderPolicyReports, getPolicyCandidates,
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
let analyzedSegments = [];
let reportOrigin = "";
const policyCatalogs = new Map();
const policyDiscoveryDone = new Set();
const policyHtmlCache = new Map();

/* ---------- helpers ---------- */

async function getActiveTab() {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return active ?? null;
}

function hostOf(url) {
    try { return new URL(url).hostname; } catch { return ""; }
}

function siteKey(url) {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
        return `${parsed.protocol}//${hostname}`;
    } catch { return ""; }
}

function applyPolicyCatalog(targetReport) {
    const key = siteKey(targetReport?.scan?.url);
    if (!key) return;
    if (!policyCatalogs.has(key)) {
        policyCatalogs.set(key, { ...(targetReport.scan.policy || {}), candidates: [...(targetReport.scan.policy?.candidates || [])] });
    }
    targetReport.scan.policy = policyCatalogs.get(key);
}

// Pages where Chrome does not allow extensions to run.
function isRestricted(url) {
    return !url || !/^https?:/.test(url) ||
        url.startsWith("https://chromewebstore.google.com") ||
        url.startsWith("https://chrome.google.com/webstore");
}

// Search results pages are not the destination site the user is trying to inspect.
// Their footer and result snippets contain unrelated links that resemble policies.
function isSearchResultsPage(url) {
    try {
        const page = new URL(url);
        const host = page.hostname.toLowerCase().replace(/^www\./, "");
        const path = page.pathname.toLowerCase();
        const hasSearchQuery = ["q", "query", "text", "p"].some((key) => page.searchParams.has(key));
        if (/^google\.[a-z.]+$/.test(host)) return path === "/search" || hasSearchQuery;
        if (host === "bing.com") return path === "/search";
        if (host === "search.yahoo.com") return path.startsWith("/search");
        if (host === "duckduckgo.com") return path === "/" && hasSearchQuery;
        if (host === "search.brave.com") return path.startsWith("/search");
        if (host === "ecosia.org") return path.startsWith("/search") || hasSearchQuery;
        if (host === "qwant.com") return path.startsWith("/search") || hasSearchQuery;
        if (/^yandex\.[a-z.]+$/.test(host)) return path === "/search";
    } catch { /* Non-URL tabs are handled by isRestricted. */ }
    return false;
}

function setPolicyDiscoveryVisible(visible) {
    const section = document.querySelector(".policy-discovery");
    if (section) section.hidden = !visible;
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
        setPolicyDiscoveryVisible(!isSearchResultsPage(tab?.url || ""));
        const nextOrigin = siteKey(tab?.url || "");
        if (nextOrigin !== reportOrigin) {
            reportOrigin = nextOrigin;
            analyzedSegments = [];
            renderPolicyReports(analyzedSegments);
        }
        setScanningSite(hostOf(tab?.url));
        showState("scanning");

        // Show this tab's last result while the fresh scan runs.
        if (!USE_MOCK && tab?.id != null) {
            const cached = await getReport(tab.id);
            if (cached) {
                report = cached;
                applyPolicyCatalog(cached);
                renderReport(cached);
                showState("result");
                checkReputation(cached, tab.id);
            }
        }

        if (!USE_MOCK && isRestricted(tab?.url)) {
            throw { error: true, code: "RESTRICTED_PAGE" };
        }

        report = USE_MOCK ? await source.scan(tab?.id) : await scanReal(tab?.id);
        applyPolicyCatalog(report);
        renderReport(report);
        showState("result");
        const searchResults = isSearchResultsPage(report?.scan?.url || tab?.url || "");
        setPolicyDiscoveryVisible(!searchResults);
        if (!USE_MOCK && !searchResults) discoverRelatedPolicyLinks(report);
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
    if (busy || !report || tab?.id == null) return;
    busy = true;
    setAnalyzeButton("loading");
    try {
        const analysis = await source.analyze(tab.id);
        report.policyAnalysis = analysis;
        const currentPage = analyzedSegments.findIndex((segment) => segment.category === "Current page");
        const currentSegment = { title: "Current page", category: "Current page", analysis };
        if (currentPage >= 0) analyzedSegments[currentPage] = currentSegment;
        else analyzedSegments.push(currentSegment);
        renderPolicyReports(analyzedSegments);
        renderWarnings(report.warnings);
        setAnalyzeButton("done");
        $("open-policy-reports").focus();
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

function policyPageText(html) {
    const documentPage = new DOMParser().parseFromString(html, "text/html");
    documentPage.querySelectorAll("script,style,noscript,template,svg,canvas,iframe,form,input,textarea,select,button,nav,header,footer,[hidden],[aria-hidden='true'],[contenteditable]")
        .forEach((node) => node.remove());
    return (documentPage.body?.textContent || "").replace(/\s+/g, " ").trim();
}

function isPublicPolicyUrl(candidate) {
    const pageUrl = new URL(candidate.href);
    if (!["http:", "https:"].includes(pageUrl.protocol)) throw new Error("Only public web pages can be read.");
    if (pageUrl.username || pageUrl.password || pageUrl.hostname.startsWith("[") || /^(localhost|.*\.local|.*\.localhost)$/i.test(pageUrl.hostname) ||
        /^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc|fd)/i.test(pageUrl.hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(pageUrl.hostname)) {
        throw new Error("This link does not point to a public website.");
    }
    return pageUrl;
}

async function fetchPolicyHtml(candidate) {
    const pageUrl = isPublicPolicyUrl(candidate);
    pageUrl.search = "";
    pageUrl.hash = "";
    const cacheKey = pageUrl.href;
    if (policyHtmlCache.has(cacheKey)) return policyHtmlCache.get(cacheKey);
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(pageUrl.href, {
            credentials: "omit",
            referrerPolicy: "no-referrer",
            redirect: "error",
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`Page returned HTTP ${response.status}.`);
        const contentType = response.headers.get("content-type") || "";
        if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error("This link did not return a readable HTML page.");
        const declaredSize = Number(response.headers.get("content-length") || 0);
        if (declaredSize > 2_000_000) throw new Error("This policy page is too large to read safely.");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("The policy page could not be read.");
        const chunks = [];
        let size = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 2_000_000) {
                await reader.cancel();
                throw new Error("This policy page is too large to read safely.");
            }
            chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const html = new TextDecoder().decode(bytes);
        if (policyHtmlCache.size >= 10) policyHtmlCache.delete(policyHtmlCache.keys().next().value);
        policyHtmlCache.set(cacheKey, html);
        return html;
    } finally {
        clearTimeout(timerId);
    }
}

async function readPolicyPage(candidate) {
    try {
        const text = policyPageText(await fetchPolicyHtml(candidate));
        if (text.length < 30) throw new Error("This policy page has too little readable text.");
        return text;
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new Error("This policy page took too long to load. Open it in a tab and try Analyze this page.");
        }
        if (error instanceof TypeError || /failed to fetch|redirect/i.test(error?.message || "")) {
            throw new Error("This site blocked the extension from reading this link. Open the policy page in a tab, then use Analyze this page.");
        }
        throw error;
    }
}

function findPolicyLinks(html, baseUrl) {
    // The linked site is untrusted input. Remove inline handlers before parsing
    // so they cannot run and do not generate extension CSP violations.
    const inertHtml = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
        .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    const parsed = new DOMParser().parseFromString(inertHtml, "text/html");
    parsed.querySelectorAll("script,style,noscript,template,svg,[hidden],[aria-hidden='true']").forEach((node) => node.remove());
    const matches = [];
    const seen = new Set();
    const policyPattern = /privacy|cookie|\bpolicy\b|data protection|data processing|data retention|data policy|personal data|data use|information practices|do not sell|privacy choices|terms(?:\s+(?:and|&)\s+conditions)?|terms of service|user agreement|acceptable use|community guidelines|security policy|responsible disclosure|legal notice|disclaimer|copyright|refund|return policy|shipping policy|accessibility statement/i;
    for (const anchor of parsed.querySelectorAll("a[href]")) {
        const label = (anchor.textContent || "").replace(/\s+/g, " ").trim();
        const rawHref = anchor.getAttribute("href") || "";
        if (/^[#?]/.test(rawHref.trim())) continue;
        let url;
        try { url = new URL(rawHref, baseUrl); } catch { continue; }
        if (!["http:", "https:"].includes(url.protocol) || !policyPattern.test(`${label} ${url.pathname}`)) continue;
        const key = `${url.origin.replace(/^https?:\/\/www\./i, "https://")}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({ text: label || "Policy page", href: url.href });
    }
    return matches;
}

async function discoverRelatedPolicyLinks(targetReport) {
    const pageUrl = targetReport?.scan?.url;
    applyPolicyCatalog(targetReport);
    const candidates = getPolicyCandidates(targetReport?.scan?.policy);
    if (!pageUrl || !candidates.length) return;
    const key = siteKey(pageUrl);
    if (!key || policyDiscoveryDone.has(key)) return;
    policyDiscoveryDone.add(key);
    const analyzeButton = $("btn-analyze-policies");
    analyzeButton.disabled = true;
    analyzeButton.textContent = "Finding policies…";
    $("policy-hint").textContent = `Found ${candidates.length} policy links. Looking for related policies…`;

    // Verify each linked page and follow one level to discover additional
    // policies. Pages that cannot be loaded or have no readable text are omitted.
    const directPages = await Promise.all(candidates.map(async (candidate) => {
        try {
            const html = await fetchPolicyHtml(candidate);
            if (policyPageText(html).length < 30) return null;
            return { candidate, html };
        } catch {
            return null;
        }
    }));
    const readableDirectPages = directPages.filter(Boolean);
    const relatedLinks = readableDirectPages.flatMap(({ candidate, html }) => findPolicyLinks(html, candidate.href));
    const directHrefs = new Set(readableDirectPages.map(({ candidate }) => candidate.href));
    const relatedCandidates = getPolicyCandidates({ candidates: relatedLinks })
        .filter((candidate) => !directHrefs.has(candidate.href));
    const relatedPages = await Promise.all(relatedCandidates.map(async (candidate) => {
        try {
            const html = await fetchPolicyHtml(candidate);
            return policyPageText(html).length >= 30 ? candidate : null;
        } catch {
            return null;
        }
    }));
    const catalog = policyCatalogs.get(key);
    if (!catalog) return;
    const kept = [...readableDirectPages.map(({ candidate }) => candidate), ...relatedPages.filter(Boolean)];
    catalog.candidates = kept.map((candidate) => ({ text: candidate.category, href: candidate.href }));
    catalog.found = kept.some((candidate) => candidate.category === "Privacy policy");
    catalog.url = kept.find((candidate) => candidate.category === "Privacy policy")?.href || null;
    if (report && siteKey(report.scan?.url) === key) {
        report.scan.policy = catalog;
        renderReport(report);
    }
}

async function analyzeDetectedPolicies() {
    if (busy || !report || !tab?.url) return;
    const candidates = getPolicyCandidates(report.scan?.policy).slice(0, 12);
    if (!candidates.length) return;
    busy = true;
    const button = $("btn-analyze-policies");
    button.disabled = true;
    button.textContent = "Reading policies…";
    const segments = [];
    try {
        const pages = await Promise.all(candidates.map(async (candidate) => {
            try {
                return { candidate, pageText: await readPolicyPage(candidate) };
            } catch (error) {
                return { candidate, error: error?.message || "Could not read this policy page." };
            }
        }));
        const readable = pages.filter((page) => page.pageText);
        if (readable.length) {
            button.textContent = "Analyzing policies…";
            const textBudget = 30000;
            const perPageLimit = Math.floor(textBudget / readable.length);
            const documents = readable.map((page) => ({
                label: page.candidate.category,
                pageText: page.pageText.slice(0, perPageLimit)
            }));
            const origin = new URL(tab.url).origin;
            let analyses = [];
            try {
                const result = await source.analyzePolicies(origin, documents);
                analyses = Array.isArray(result?.reports) ? result.reports : [];
            } catch (error) {
                const { title, message } = errorCopy(toError(error).code, toError(error).message);
                analyzedSegments = analyzedSegments.filter((segment) => segment.category === "Current page");
                renderPolicyReports(analyzedSegments);
                renderWarnings(report.warnings);
                addWarning(`${title}. ${message}`);
                button.textContent = "Analysis unavailable";
                return;
            }
            readable.forEach((page, index) => {
                const analysis = analyses[index];
                if (analysis) segments.push({
                    href: page.candidate.href,
                    title: page.candidate.displayTitle,
                    category: page.candidate.category,
                    analysis
                });
            });
            // Show only successfully fetched and analyzed policies, in link order.
            analyzedSegments = [...segments, ...analyzedSegments.filter((segment) => segment.category === "Current page")];
            renderPolicyReports(analyzedSegments);
            button.textContent = "Policies analyzed";
        } else {
            analyzedSegments = analyzedSegments.filter((segment) => segment.category === "Current page");
            renderPolicyReports(analyzedSegments);
            button.textContent = "No readable policies";
        }
    } catch (err) {
        const { title, message } = errorCopy(toError(err).code, toError(err).message);
        renderWarnings(report.warnings);
        addWarning(`${title}. ${message}`);
        button.textContent = "Try analyzing policies again";
    } finally {
        busy = false;
        button.disabled = getPolicyCandidates(report?.scan?.policy).length === 0;
    }
}

/* ---------- wiring ---------- */

$("btn-scan").addEventListener("click", startScan);
$("btn-rescan").addEventListener("click", startScan);
$("btn-retry").addEventListener("click", startScan);
$("btn-analyze").addEventListener("click", analyzePolicy);
$("btn-analyze-policies").addEventListener("click", analyzeDetectedPolicies);
$("open-policy-reports").addEventListener("click", () => {
    const dialog = $("policy-report-dialog");
    if (!dialog.open && !$("open-policy-reports").disabled) dialog.showModal();
});
$("close-policy-reports").addEventListener("click", () => $("policy-report-dialog").close());

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
        applyPolicyCatalog(report);
        renderReport(report);
        showState("result");
        const searchResults = isSearchResultsPage(report?.scan?.url || tab?.url || "");
        setPolicyDiscoveryVisible(!searchResults);
        if (!searchResults) discoverRelatedPolicyLinks(report);
        if (tab?.id != null) checkReputation(report, tab.id);
    });
    startScan();
} else {
    showState("idle");
}
