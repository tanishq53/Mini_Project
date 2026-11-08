// PrivacyGuard side panel rendering. Owner: Tanishq.
// Pure display code: takes data in the shape of docs/contract.md and fills the elements in popup.html.
// It never calls the backend and never uses innerHTML, so page-supplied text cannot inject markup.

import { PHASE2_POLICY } from "../utils/config.js";

const $ = (id) => document.getElementById(id);

// Hides everything marked data-phase2 while the switch in config.js is false.
// Inline display is used (not the hidden attribute) because .row uses display:flex, which beats [hidden].
export function applyPhaseSwitch() {
    for (const node of document.querySelectorAll("[data-phase2]")) {
        node.style.display = PHASE2_POLICY ? "" : "none";
    }
}

/* ---------- helpers ---------- */

const RISK_KEYS = ["low", "moderate", "high", "very-high"];
const RISK_LABEL = {
    "low": "Low exposure",
    "moderate": "Moderate exposure",
    "high": "High exposure",
    "very-high": "Very high exposure"
};

// "Very High" -> "very-high". Falls back to score bands if the level is missing or unknown.
export function riskKey(level, score) {
    if (typeof level === "string") {
        const key = level.trim().toLowerCase().replace(/\s+/g, "-");
        if (RISK_KEYS.includes(key)) return key;
    }
    const s = Number(score) || 0;
    if (s <= 25) return "low";
    if (s <= 50) return "moderate";
    if (s <= 75) return "high";
    return "very-high";
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// Fill a number into a .row-value. Zero is shown muted. Missing data shows a dash.
function setNumber(id, value) {
    const node = $(id);
    if (!node) return;
    const missing = value === undefined || value === null;
    node.textContent = missing ? "\u2014" : String(value);
    node.classList.toggle("zero", value === 0 || missing);
}

function makeRow(name, value, { indent = false, stack = false } = {}) {
    const row = el("div", "row" + (indent ? " indent" : "") + (stack ? " stack" : ""));
    row.append(el("span", "row-name", name));
    const val = el("span", "row-value");
    if (value instanceof Node) val.append(value);
    else val.textContent = value;
    row.append(val);
    return row;
}

function makeTag(text, kind) {
    return el("span", "tag" + (kind ? " " + kind : ""), text);
}

// Only http(s) links are shown, so a page cannot slip in javascript: links.
function safeUrl(href) {
    try {
        const u = new URL(href);
        return u.protocol === "https:" || u.protocol === "http:" ? u : null;
    } catch {
        return null;
    }
}

function shortUrl(u) {
    const host = u.hostname.replace(/^www\./, "");
    return u.pathname && u.pathname !== "/" ? host + u.pathname : host;
}

function listText(items) {
    return Array.isArray(items) && items.length ? items.join(", ") : "Not specified";
}

/* ---------- states ---------- */

const STATES = ["idle", "scanning", "result", "error"];

export function showState(state) {
    if (!STATES.includes(state)) throw new Error("Unknown state: " + state);
    $("app").dataset.state = state;
}

export function setScanningSite(host) {
    $("scanning-site").textContent = host || "this page";
}

/* ---------- result view ---------- */

const FIELD_LABELS = [
    ["name", "Name"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["address", "Address"],
    ["dob", "Date of birth"],
    ["password", "Password"],
    ["financial", "Financial details"],
    ["governmentId", "Government ID"]
];

function renderFieldTypes(fieldTypes) {
    const box = $("fieldtypes");
    box.replaceChildren();
    let shown = 0;
    for (const [key, label] of FIELD_LABELS) {
        const n = fieldTypes?.[key] ?? 0;
        if (n > 0) {
            box.append(makeRow(label, String(n), { indent: true }));
            shown++;
        }
    }
    if (shown === 0) box.append(makeRow("None detected", "", { indent: true }));
}

function renderExpandableRows(containerId, rows) {
    const container = $(containerId);
    container.replaceChildren();

    for (const { key, label, count, items, detailsAvailable, formatItem } of rows) {
        const row = el("div", "row detail-row");
        row.append(el("span", "row-name", label));

        const value = el("span", "row-value detail-value");
        const missing = count === undefined || count === null;
        const countNode = el("span", "detail-count", missing ? "\u2014" : String(count));
        countNode.classList.toggle("zero", missing || count === 0);
        value.append(countNode);

        const detailsId = `${containerId}-${key}-details`;
        const toggle = el("button", "detail-toggle");
        toggle.type = "button";
        toggle.setAttribute("aria-label", `Show ${label.toLowerCase()} details`);
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-controls", detailsId);
        toggle.append(el("span", "detail-chevron"));
        value.append(toggle);
        row.append(value);
        container.append(row);

        const list = el("ul", "details-list");
        list.id = detailsId;
        list.hidden = true;

        if (missing || !detailsAvailable || (count > 0 && !items.length)) {
            list.append(el("li", "muted", "Details are unavailable for this scan."));
        } else if (count === 0) {
            list.append(el("li", "muted", "None detected."));
        } else {
            let shown = 0;
            const moreButton = el("button", "details-more", "Show 10 more");
            moreButton.type = "button";
            const moreItem = el("li");
            moreItem.append(moreButton);
            list.append(moreItem);
            const appendNextPage = () => {
                const nextItems = items.slice(shown, shown + 10);
                for (const item of nextItems) {
                    const detail = el("li", "", formatItem(item));
                    list.insertBefore(detail, moreItem);
                    shown++;
                }
                moreButton.hidden = shown >= items.length;
            };
            appendNextPage();
            moreButton.addEventListener("click", appendNextPage);
        }
        container.append(list);

        toggle.addEventListener("click", () => {
            const expanded = toggle.getAttribute("aria-expanded") === "true";
            toggle.setAttribute("aria-expanded", String(!expanded));
            toggle.setAttribute("aria-label", `${expanded ? "Show" : "Hide"} ${label.toLowerCase()} details`);
            list.hidden = expanded;
        });
    }
}

function renderTrackers(tracking) {
    const counts = tracking?.trackers;
    const trackerList = tracking?.trackerList;
    const categories = [
        ["analytics", "Analytics"],
        ["advertising", "Advertising"],
        ["social", "Social media"],
        ["unknown", "Unrecognised third party"]
    ];

    renderExpandableRows("tracker-rows", categories.map(([key, label]) => ({
        key,
        label,
        count: counts?.[key],
        items: Array.isArray(trackerList)
            ? trackerList.filter((tracker) => tracker.category === key && typeof tracker.domain === "string")
            : [],
        detailsAvailable: Array.isArray(trackerList),
        formatItem: (tracker) => tracker.domain
    })));
}

function renderCookies(cookies) {
    const firstParty = cookies?.firstPartyList;
    const thirdParty = cookies?.thirdPartyList;
    const hasDetails = cookies?.detailsAvailable === true;
    const firstItems = Array.isArray(firstParty) ? firstParty : [];
    const thirdItems = Array.isArray(thirdParty) ? thirdParty : [];
    const formatCookie = (cookie) => {
        const name = cookie.name || "(unnamed cookie)";
        return cookie.domain ? `${name} (${cookie.domain})` : name;
    };

    renderExpandableRows("cookie-rows", [
        {
            key: "total",
            label: "Total",
            count: cookies?.total,
            items: [...firstItems, ...thirdItems],
            detailsAvailable: hasDetails,
            formatItem: formatCookie
        },
        {
            key: "first-party",
            label: "First-party",
            count: cookies?.firstParty,
            items: firstItems,
            detailsAvailable: hasDetails,
            formatItem: formatCookie
        },
        {
            key: "third-party",
            label: "Third-party",
            count: cookies?.thirdParty,
            items: thirdItems,
            detailsAvailable: hasDetails,
            formatItem: formatCookie
        }
    ]);
}

function policyCategory(text, href) {
    const value = `${text || ""} ${href || ""}`.toLowerCase();
    if (/cookie|tracking|consent/.test(value)) return "Cookie policy";
    if (/refund|return/.test(value)) return "Refund & returns";
    if (/shipping|delivery/.test(value)) return "Shipping policy";
    if (/accessibility/.test(value)) return "Accessibility statement";
    if (/terms|user agreement|acceptable use|community guidelines/.test(value)) return "Terms & use";
    if (/security|vulnerability|responsible disclosure/.test(value)) return "Security policy";
    if (/data protection|data processing|personal data|data use|information practices/.test(value)) return "Data policy";
    if (/privacy/.test(value)) return "Privacy policy";
    if (/legal|disclaimer|copyright/.test(value)) return "Legal notice";
    return "Other policy";
}

export function getPolicyCandidates(policy) {
    const found = [];
    const seen = new Set();
    const add = (href, text) => {
        const url = safeUrl(href);
        if (!url) return;
        const host = url.hostname.replace(/^www\./i, "").toLowerCase();
        const pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "").toLowerCase() || "/";
        const key = `${url.protocol}//${host}${pathname}`;
        if (seen.has(key)) return;
        seen.add(key);
        const label = (text || "").trim();
        const category = policyCategory(label, `${url.origin}${url.pathname}`);
        found.push({
            title: category,
            category,
            source: host,
            pathName: pathname.split("/").filter(Boolean).at(-1) || host,
            href: url.href
        });
    };

    for (const candidate of policy?.candidates ?? []) add(candidate.href, candidate.text);
    if (policy?.found && policy.url) add(policy.url, "Privacy policy");
    const categoryCounts = new Map();
    const categoryHostCounts = new Map();
    for (const candidate of found) {
        categoryCounts.set(candidate.category, (categoryCounts.get(candidate.category) || 0) + 1);
        const key = `${candidate.category}|${candidate.source}`;
        categoryHostCounts.set(key, (categoryHostCounts.get(key) || 0) + 1);
    }
    for (const candidate of found) {
        const sameType = categoryCounts.get(candidate.category) > 1;
        const sameHost = categoryHostCounts.get(`${candidate.category}|${candidate.source}`) > 1;
        candidate.sourceLabel = sameType ? (sameHost ? candidate.pathName : candidate.source) : "";
        candidate.displayTitle = candidate.sourceLabel
            ? `${candidate.title} · ${candidate.sourceLabel}`
            : candidate.title;
    }
    return found;
}

function renderPolicyLinks(policy) {
    const list = $("policy-links");
    list.replaceChildren();
    const candidates = getPolicyCandidates(policy);
    const hint = $("policy-hint");
    const button = $("btn-analyze-policies");
    hint.textContent = candidates.length
        ? `${candidates.length} linked policy page${candidates.length === 1 ? "" : "s"} found.${candidates.length > 12 ? " The first 12 can be analyzed in one run." : ""}`
        : "No linked policy pages were detected on this page.";
    button.disabled = candidates.length === 0;
    button.textContent = candidates.length ? "Analyze policies" : "No policies found";

    for (const candidate of candidates) {
        const li = el("li", "policy-link-row");
        const a = el("a", "policy-link-anchor", candidate.title);
        a.href = candidate.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        li.append(a);
        if (candidate.sourceLabel) li.append(el("span", "policy-kind", candidate.sourceLabel));
        list.append(li);
    }
    if (candidates.length === 0) {
        const li = el("li");
        li.append(el("span", "muted", "Try opening a page that links to the site's policies, then rescan."));
        list.append(li);
    }
}

function renderRecommendations(items) {
    const list = $("reco");
    list.replaceChildren();
    if (!items?.length) {
        list.append(el("li", "", "No recommendations for this page."));
        return;
    }
    for (const text of items) list.append(el("li", "", text));
}

export function renderWarnings(warnings) {
    const box = $("warnings");
    box.replaceChildren();
    for (const text of warnings ?? []) addWarning(text);
}

export function addWarning(text) {
    const banner = el("div", "banner warn", text);
    $("warnings").append(banner);
}

function renderDetailList(containerId, items, count, emptyText = "None detected") {
    const box = $(containerId);
    if (!box) return;
    box.replaceChildren();

    if (!items || !items.length) {
        if (count && count > 0) {
            box.append(el("div", "detail-empty", `${count} detected`));
        } else {
            box.append(el("div", "detail-empty", emptyText));
        }
        return;
    }

    for (const item of items) {
        const row = el("div", "detail-item");
        row.append(el("span", "detail-bullet"));
        const name = typeof item === "string" ? item : (item.name || item.domain || "Unknown");
        row.append(el("span", "detail-name", name));
        if (typeof item === "object" && item.domain && item.name && item.domain !== item.name) {
            row.append(el("span", "detail-domain", item.domain));
        }
        box.append(row);
    }
}

export function initExpandableRows() {
    document.querySelectorAll(".row-toggle").forEach((toggle) => {
        if (toggle.dataset.listenerAttached) return;
        toggle.dataset.listenerAttached = "true";
        toggle.setAttribute("role", "button");
        toggle.setAttribute("tabindex", "0");
        toggle.setAttribute("aria-expanded", "false");

        const handleToggle = () => {
            const rowValue = toggle.querySelector(".row-value");
            if (rowValue && (rowValue.classList.contains("zero") || rowValue.textContent === "0" || rowValue.textContent === "\u2014")) {
                return;
            }
            const parent = toggle.closest(".expandable-row");
            if (parent) {
                const isOpen = parent.classList.toggle("open");
                toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
            }
        };

        toggle.addEventListener("click", handleToggle);
        toggle.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleToggle();
            }
        });
    });
}

// report = { scan, result, policyAnalysis, warnings }  (docs/contract.md section 7)
export function renderReport(report) {
    const scan = report?.scan ?? {};
    const result = report?.result ?? {};

    // Header and score
    let host = scan.hostname;
    if (!host && scan.url) host = safeUrl(scan.url)?.hostname;
    $("site").textContent = host || "Unknown site";

    const key = riskKey(result.riskLevel, result.riskScore);
    document.querySelector('[data-view="result"]').dataset.risk = key;

    const value = $("score-value");
    value.replaceChildren(String(result.riskScore ?? "\u2014"), el("small", "", "/100"));
    $("score-level").textContent = RISK_LABEL[key];
    $("meter")
        .querySelectorAll("span")
        .forEach((seg, i) => seg.classList.toggle("on", i <= RISK_KEYS.indexOf(key)));

    // Personal data
    setNumber("v-forms", scan.scanner?.forms);
    setNumber("v-fields", scan.scanner?.personalDataFields);
    renderFieldTypes(scan.scanner?.fieldTypes);

    // Trackers and cookies
    renderTrackers(scan.tracking);
    renderCookies(scan.tracking?.cookies);

    // Render tracker details
    const trackers = scan.tracking?.trackers || {};
    const trackerList = scan.tracking?.trackerList || [];
    renderDetailList("details-analytics", trackerList.filter((t) => t.category === "analytics"), trackers?.analytics);
    renderDetailList("details-advertising", trackerList.filter((t) => t.category === "advertising"), trackers?.advertising);
    renderDetailList("details-social", trackerList.filter((t) => t.category === "social"), trackers?.social);
    renderDetailList("details-unknown", trackerList.filter((t) => t.category === "unknown"), trackers?.unknown);

    // Render cookie details
    const cookies = scan.tracking?.cookies || {};
    const firstCookies = cookies?.firstPartyList || [];
    const thirdCookies = cookies?.thirdPartyList || [];
    const allCookies = [...firstCookies, ...thirdCookies];
    renderDetailList("details-cookies-all", allCookies, cookies?.total);
    renderDetailList("details-cookies-first", firstCookies, cookies?.firstParty);
    renderDetailList("details-cookies-third", thirdCookies, cookies?.thirdParty);

    // Ensure rows whose count is zero or missing are collapsed
    document.querySelectorAll(".expandable-row").forEach((row) => {
        const val = row.querySelector(".row-value");
        const toggle = row.querySelector(".row-toggle");
        if (!val || val.classList.contains("zero") || val.textContent === "0" || val.textContent === "\u2014") {
            row.classList.remove("open");
            if (toggle) toggle.setAttribute("aria-expanded", "false");
        }
    });
    initExpandableRows();

    // Connection
    const https = $("v-https");
    https.className = "tag " + (scan.https ? "ok" : "bad");
    https.textContent = scan.https ? "HTTPS" : "HTTP";
    const tls = $("v-tls");
    const tlsState = scan.tls;
    if (!scan.https) {
        tls.className = "tag";
        tls.textContent = "Not applicable";
    } else if (tlsState === "secure") {
        tls.className = "tag ok";
        tls.textContent = "Trusted by backend";
    } else if (tlsState === "insecure") {
        tls.className = "tag bad";
        tls.textContent = "Certificate not trusted";
    } else if (tlsState === "broken") {
        tls.className = "tag bad";
        tls.textContent = "TLS handshake failed";
    } else {
        tls.className = "tag warn";
        tls.textContent = "Could not check";
    }

    // Policy
    renderPolicyLinks(scan.policy);

    // Score breakdown
    setNumber("b-personal", result.breakdown?.personalData);
    setNumber("b-trackers", result.breakdown?.trackers);
    setNumber("b-security", result.breakdown?.security);

    renderRecommendations(result.recommendations);
    renderWarnings(report?.warnings);

    setAnalyzeButton(report?.policyAnalysis ? "done" : "ready");
}

const THREAT_LABELS = {
    MALWARE: "Malware",
    SOCIAL_ENGINEERING: "Phishing or deceptive content",
    UNWANTED_SOFTWARE: "Unwanted software"
};

export function renderReputation(result) {
    const status = $("reputation-status");
    const message = $("reputation-message");
    const states = {
        checking: ["Checking", "Checking this page's path with Google Safe Browsing.", "warn"],
        not_configured: [
            "Not configured",
            "Add GOOGLE_SAFE_BROWSING_API_KEY to backend/.env and restart the backend to enable this check.",
            "warn"
        ],
        mock: [
            "Demo mode",
            "Site reputation checks are not run while using mock scan data.",
            "warn"
        ],
        unavailable: [
            "Unavailable",
            "Google Safe Browsing could not check this domain. The privacy score is unaffected.",
            "warn"
        ],
        safe: [
            "No known threats",
            "Google Safe Browsing found no listed threats for this domain. This does not guarantee the site or its downloads are safe.",
            "ok"
        ],
        unsafe: [
            "Threat reported",
            "",
            "bad"
        ]
    };
    const state = states[result?.status] || states.unavailable;
    status.textContent = state[0];
    status.className = "tag " + state[2];

    if (result?.status === "unsafe") {
        const threats = (result.threatTypes || [])
            .map((type) => THREAT_LABELS[type])
            .filter(Boolean);
        message.textContent = threats.length
            ? `Google Safe Browsing flagged this domain for: ${threats.join(", ")}. Avoid visiting or downloading from it.`
            : "Google Safe Browsing flagged this domain. Avoid visiting or downloading from it.";
        return;
    }
    message.textContent = state[1];
}

/* ---------- policy summary ---------- */

function appendAnalysisBullets(container, analysis) {
    const list = el("ol", "analysis-list");
    const addBullet = (label, value) => {
        if (typeof value !== "string" || !value.trim()) return;
        const item = el("li", "");
        item.append(el("strong", "analysis-label", `${label}: `), document.createTextNode(value.trim()));
        list.append(item);
    };
    const addBulletGroup = (label, values) => {
        if (!Array.isArray(values) || !values.some((value) => typeof value === "string" && value.trim())) return;
        const item = el("li", "analysis-group");
        item.append(el("strong", "analysis-label", `${label}:`));
        const nested = el("ol", "analysis-sublist");
        values.filter((value) => typeof value === "string" && value.trim())
            .slice(0, 6)
            .forEach((value) => nested.append(el("li", "", value.trim())));
        item.append(nested);
        list.append(item);
    };

    addBullet("Page type", analysis.pageType || "Not identified");
    addBullet("Summary", analysis.summary || "No summary was returned.");
    addBulletGroup("Key points", analysis.keyPoints);
    addBulletGroup("Privacy signals", analysis.privacySignals);

    const policy = analysis.policyDetails || {};
    const policyPage = /privacy|terms|legal|cookie|data protection/i.test(analysis.pageType || "");
    const sharingSpecified = ["Yes", "No"].includes(policy.dataSharing);
    const hasPolicyDetails = [policy.dataCollected, policy.purposes, policy.concerns]
        .some((values) => Array.isArray(values) && values.length > 0) ||
        sharingSpecified ||
        [policy.thirdParties, policy.retention, policy.deletion]
            .some((value) => typeof value === "string" && value.trim() && !/^(not stated|unclear)/i.test(value.trim()));
    if (policyPage || hasPolicyDetails) {
        addBulletGroup("Data collected", policy.dataCollected);
        addBulletGroup("Purposes", policy.purposes);
        addBullet("Data sharing", policy.dataSharing || "Unclear");
        addBullet("Third parties", policy.thirdParties || "Not stated on this page");
        addBullet("Retention", policy.retention || "Not stated on this page");
        addBullet("Deletion", policy.deletion || "Not stated on this page");
        addBulletGroup("Potential concerns", policy.concerns);
    }
    container.append(list);
}

export function renderPolicyReports(segments) {
    const list = $("policy-report-list");
    const opener = $("open-policy-reports");
    const count = $("policy-report-count");
    list.replaceChildren();
    const reports = Array.isArray(segments) ? segments.filter((segment) => segment?.analysis) : [];
    opener.disabled = reports.length === 0;
    count.textContent = reports.length
        ? `${reports.length} report${reports.length === 1 ? "" : "s"} · expand one to read it`
        : "Analyze this page or the linked policy pages to build a report.";

    reports.forEach((segment, index) => {
        const section = el("details", "policy-report-segment");
        const heading = el("summary", "policy-report-summary");
        heading.append(el("span", "policy-report-title", `${index + 1}. ${segment.title || segment.category || "Policy page"}`));
        const helpText = segment.analysis.summary || segment.analysis.keyPoints?.[0]
            || "Expand this section to read the analyzed points for this policy page.";
        const help = el("span", "policy-report-help", "?");
        help.tabIndex = 0;
        help.setAttribute("role", "note");
        help.setAttribute("aria-label", `Quick information: ${helpText}`);
        const tooltip = el("span", "policy-report-tooltip", `Quick overview: ${helpText}`);
        tooltip.setAttribute("role", "tooltip");
        help.append(tooltip);
        const placeTooltip = () => {
            const iconBounds = help.getBoundingClientRect();
            const listBounds = list.getBoundingClientRect();
            const below = listBounds.bottom - iconBounds.bottom;
            const above = iconBounds.top - listBounds.top;
            help.classList.toggle("tooltip-above", below < 150 && above > below);
        };
        help.addEventListener("pointerenter", placeTooltip);
        help.addEventListener("focus", placeTooltip);
        heading.append(help);
        section.append(heading);
        appendAnalysisBullets(section, segment.analysis);
        section.addEventListener("toggle", () => {
            if (!section.open) return;
            for (const other of list.querySelectorAll(".policy-report-segment[open]")) {
                if (other !== section) other.open = false;
            }
        });
        list.append(section);
    });
}

// mode: "ready" | "loading" | "done" | "unavailable"
export function setAnalyzeButton(mode) {
    const btn = $("btn-analyze");
    const labels = {
        ready: "Analyze this page",
        loading: "Analyzing page\u2026",
        done: "Page analyzed",
        unavailable: "Analysis unavailable"
    };
    btn.textContent = labels[mode] ?? labels.ready;
    btn.disabled = mode !== "ready";
}

/* ---------- errors ---------- */

// Error codes are defined in docs/contract.md section 8.
export function errorCopy(code, fallbackMessage) {
    const copy = {
        RESTRICTED_PAGE: [
            "Can't scan this page",
            "Chrome does not let extensions read this page. Open a regular website and try again."
        ],
        SCAN_TIMEOUT: [
            "The scan took too long",
            "The page did not respond in time. Reload the page and scan again."
        ],
        BACKEND_UNREACHABLE: [
            "Can't reach the PrivacyGuard server",
            "Start the backend on port 8000 and try again."
        ],
        SERVER_MISCONFIGURED: [
            "Backend is not configured",
            "Set the API key in the backend environment and in PrivacyGuard settings."
        ],
        POLICY_FETCH_FAILED: [
            "Couldn't read the privacy policy",
            "The policy page did not load. Open it in a tab and scan that page instead."
        ],
        GEMINI_FAILED: [
            "Page analysis unavailable",
            "Check the backend Gemini API key and connection, then try again."
        ],
        EXTENSION_AUTH_REQUIRED: [
            "Connect PrivacyGuard first",
            "Sign in to the dashboard, create a connection key, then save it in the extension options."
        ],
        INVALID_INPUT: [
            "Unexpected data",
            "A module returned data in the wrong format. Check it against docs/contract.md."
        ],
        AUTH_REQUIRED: [
            "Backend authentication required",
            "Add the backend bearer token in PrivacyGuard settings, or check with the backend administrator."
        ],
        RATE_LIMITED: [
            "Too many scans",
            "Wait a minute before scanning again."
        ],
        HTTPS_REQUIRED: [
            "Secure connection required",
            "The backend must be accessed over HTTPS outside local development."
        ],
        PAYLOAD_TOO_LARGE: [
            "Page scan is too large",
            "This page contains more scan metadata than the backend accepts."
        ]
    };
    const [title, message] = copy[code] ?? ["Something went wrong", fallbackMessage || "Try again."];
    return { title, message };
}

export function renderError(error) {
    const { title, message } = errorCopy(error?.code, error?.message);
    $("error-title").textContent = title;
    $("error-message").textContent = message;
    showState("error");
}
