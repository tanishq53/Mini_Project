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

function renderPolicyLinks(policy) {
    const list = $("policy-links");
    list.replaceChildren();

    const main = policy?.found ? safeUrl(policy.url) : null;
    const status = $("v-policy");
    status.className = "tag " + (main ? "ok" : "warn");
    status.textContent = main ? "Found" : "Not found";

    const addLink = (u, text) => {
        const li = el("li");
        const a = el("a", "", text || shortUrl(u));
        a.href = u.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        li.append(a);
        list.append(li);
    };

    if (main) {
        addLink(main);
        return;
    }

    // Not found: offer anything privacy-related the scanner noticed, so the user can open it.
    const seen = new Set();
    let count = 0;
    for (const c of policy?.candidates ?? []) {
        const u = safeUrl(c.href);
        if (!u || seen.has(u.href) || count >= 5) continue;
        seen.add(u.href);
        addLink(u, c.text ? `${c.text} (${shortUrl(u)})` : undefined);
        count++;
    }
    if (count === 0) {
        const li = el("li");
        li.append(el("span", "muted", "No privacy links found on this page. Try the login or sign-up page."));
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

    // Connection
    const https = $("v-https");
    https.className = "tag " + (scan.https ? "ok" : "bad");
    https.textContent = scan.https ? "Secure" : "Not secure";

    // Policy
    renderPolicyLinks(scan.policy);

    // Score breakdown
    setNumber("b-personal", result.breakdown?.personalData);
    setNumber("b-trackers", result.breakdown?.trackers);
    setNumber("b-security", result.breakdown?.security);
    setNumber("b-policy", result.breakdown?.policy);

    renderRecommendations(result.recommendations);
    renderWarnings(report?.warnings);

    // Policy summary (only after the user clicked Analyze policy)
    renderPolicyAnalysis(report?.policyAnalysis);
    const canAnalyze = !!(scan.policy?.found && safeUrl(scan.policy.url));
    setAnalyzeButton(report?.policyAnalysis ? "done" : canAnalyze ? "ready" : "unavailable");
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
        checking: ["Checking", "Checking the site's domain.", "warn"],
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

export function renderPolicyAnalysis(analysis) {
    const section = $("policy-analysis");
    const body = $("policy-analysis-body");
    body.replaceChildren();
    if (!analysis) {
        section.hidden = true;
        return;
    }

    body.append(makeRow("Data collected", listText(analysis.dataCollected), { stack: true }));
    body.append(makeRow("Why it is collected", listText(analysis.purposes), { stack: true }));

    const shared = analysis.dataSharing
        ? makeTag("Yes", "warn")
        : makeTag("No", "ok");
    body.append(makeRow("Shared with third parties", shared));
    if (analysis.thirdParties) {
        const note = el("p", "muted", analysis.thirdParties);
        note.style.paddingBottom = "8px";
        body.append(note);
    }

    body.append(makeRow("Retention", analysis.retention || "Not specified", { stack: true }));
    body.append(makeRow("Deletion", analysis.deletion || "Not specified", { stack: true }));

    if (analysis.concerns?.length) {
        body.append(makeRow("Concerns", analysis.concerns.join(". "), { stack: true }));
    }
    section.hidden = false;
}

// mode: "ready" | "loading" | "done" | "unavailable"
export function setAnalyzeButton(mode) {
    const btn = $("btn-analyze");
    const labels = {
        ready: "Analyze policy",
        loading: "Analyzing policy\u2026",
        done: "Policy analyzed",
        unavailable: "No policy to analyze"
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
        POLICY_FETCH_FAILED: [
            "Couldn't read the privacy policy",
            "The policy page did not load. Open it in a tab and scan that page instead."
        ],
        GEMINI_FAILED: [
            "Policy summary unavailable",
            "The risk score is still valid. Try the summary again in a moment."
        ],
        INVALID_INPUT: [
            "Unexpected data",
            "A module returned data in the wrong format. Check it against docs/contract.md."
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