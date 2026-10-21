// Fake data in the exact shape of docs/contract.md. Owner: Tanishq.
// Use it to build and test the UI without the backend or the other modules.
//
// Every scenario is built with helpers that keep the numbers consistent:
//   personalDataFields = sum of fieldTypes
//   cookies.total      = firstParty + thirdParty
//   riskScore          = sum of breakdown
//   riskLevel          = band of riskScore (0-25 Low, 26-50 Moderate, 51-75 High, 76-100 Very High)
// assertConsistent() checks these rules for any report, mock or real.

const FIELD_KEYS = ["name", "email", "phone", "address", "dob", "password", "financial", "governmentId"];
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

export function levelFromScore(score) {
  if (score <= 25) return "Low";
  if (score <= 50) return "Moderate";
  if (score <= 75) return "High";
  return "Very High";
}

/* ---------- builders ---------- */

function makePolicy(hostname, path = "/privacy") {
  const href = `https://${hostname}${path}`;
  return { found: true, url: href, candidates: [{ text: "Privacy Policy", href }] };
}

function makeScan({
  hostname, path = "/", https = true, forms = 0, fields = {},
  cookiesFirst = 0, cookiesThird = 0, scripts = 0, trackers = {}, policy
}) {
  const fieldTypes = Object.fromEntries(FIELD_KEYS.map((k) => [k, fields[k] ?? 0]));
  return {
    url: `${https ? "https" : "http"}://${hostname}${path}`,
    hostname,
    scannedAt: "2026-10-02T10:00:00Z",
    https,
    scanner: { forms, personalDataFields: sum(fieldTypes), fieldTypes, fields: [] },
    tracking: {
      cookies: { total: cookiesFirst + cookiesThird, firstParty: cookiesFirst, thirdParty: cookiesThird },
      thirdPartyScripts: scripts,
      trackers: { analytics: 0, advertising: 0, social: 0, unknown: 0, ...trackers }
    },
    policy: policy ?? { found: false, url: null, candidates: [] }
  };
}

function makeReport(scan, breakdown, recommendations, extra = {}) {
  const riskScore = sum(breakdown);
  return {
    scan,
    result: {
      id: "scan_mock_" + scan.hostname.replace(/\W/g, "_"),
      url: scan.url,
      riskScore,
      riskLevel: levelFromScore(riskScore),
      breakdown,
      recommendations
    },
    policyAnalysis: extra.policyAnalysis ?? null,
    warnings: extra.warnings ?? []
  };
}

/* ---------- policy analysis samples (docs/contract.md 6.2) ---------- */

export const MOCK_POLICY_ANALYSIS = {
  dataCollected: ["Email", "Phone number", "Device information"],
  purposes: ["Account creation", "Analytics"],
  dataSharing: true,
  thirdParties: "Service providers and advertising partners mentioned",
  retention: "Not clearly specified",
  deletion: "Users can request deletion by email",
  concerns: ["Retention period is not stated"]
};

// A policy that says very little: tests the "Not specified" fallbacks.
export const MOCK_POLICY_ANALYSIS_VAGUE = {
  dataCollected: [],
  purposes: [],
  dataSharing: false,
  thirdParties: "",
  retention: "",
  deletion: "",
  concerns: []
};

/* ---------- scenarios ---------- */

const highRiskScan = makeScan({
  hostname: "example.com", path: "/login", forms: 3,
  fields: { name: 1, email: 2, phone: 1, address: 1, password: 1 },
  cookiesFirst: 9, cookiesThird: 5, scripts: 6,
  trackers: { analytics: 3, advertising: 2, social: 1, unknown: 1 },
  policy: makePolicy("example.com")
});
const highRiskRecs = [
  "Review third-party tracking before signing up.",
  "Check the privacy policy for data deletion information."
];
const highRiskBreakdown = { personalData: 30, trackers: 20, security: 3, policy: 14 };

export const SCENARIOS = {
  // 6 / Low: a simple page with one newsletter field
  lowRisk: makeReport(
    makeScan({
      hostname: "quietnotes.example", forms: 1, fields: { email: 1 },
      cookiesFirst: 2, policy: makePolicy("quietnotes.example")
    }),
    { personalData: 4, trackers: 0, security: 0, policy: 2 },
    [
      "This page collects very little data and uses no known trackers.",
      "Read the privacy policy before subscribing if you want to know how your email is used."
    ]
  ),

  // 28 / Moderate: a signup page with analytics
  moderate: makeReport(
    makeScan({
      hostname: "greenbasket.example", path: "/signup", forms: 1,
      fields: { name: 1, email: 1, password: 1 },
      cookiesFirst: 5, cookiesThird: 2, scripts: 3, trackers: { analytics: 2 },
      policy: makePolicy("greenbasket.example")
    }),
    { personalData: 14, trackers: 8, security: 0, policy: 6 },
    [
      "Use a unique password for this account.",
      "Analytics trackers are present. Check the cookie settings if you want to limit them."
    ]
  ),

  // 67 / High: the default scenario
  highRisk: makeReport(highRiskScan, highRiskBreakdown, highRiskRecs),

  // 91 / Very High: not secure, sensitive data, heavy tracking, no policy found
  veryHigh: makeReport(
    makeScan({
      hostname: "bigdeals.example", path: "/checkout", https: false, forms: 4,
      fields: { name: 2, email: 1, phone: 1, address: 2, dob: 1, password: 1, financial: 3, governmentId: 1 },
      cookiesFirst: 8, cookiesThird: 19, scripts: 22,
      trackers: { analytics: 5, advertising: 9, social: 3, unknown: 5 }
    }),
    { personalData: 34, trackers: 30, security: 15, policy: 12 },
    [
      "Do not enter payment details on a page that is not secure (HTTP).",
      "Many advertising trackers are present. Consider a tracker blocker.",
      "No privacy policy was found. Check the site's footer or its sign-up page."
    ]
  ),

  // 31 / Moderate: policy not on this page, but privacy-related links exist
  noPolicy: makeReport(
    makeScan({
      hostname: "gadgetshop.example", path: "/account/login", forms: 2,
      fields: { email: 1, password: 1 },
      cookiesFirst: 4, cookiesThird: 1, scripts: 2, trackers: { analytics: 1, unknown: 1 },
      policy: {
        found: false, url: null,
        candidates: [
          { text: "Terms & Privacy", href: "https://gadgetshop.example/terms" },
          { text: "Data Policy", href: "https://gadgetshop.example/data" }
        ]
      }
    }),
    { personalData: 10, trackers: 6, security: 0, policy: 15 },
    ["No privacy policy was found on this page. Open one of the links above to check."]
  ),

  // 2 / Low: nothing detected at all
  zeroData: makeReport(
    makeScan({ hostname: "staticpage.example", policy: makePolicy("staticpage.example") }),
    { personalData: 0, trackers: 0, security: 0, policy: 2 },
    ["No forms, cookies or trackers were found on this page."]
  ),

  // High, after the user clicked Analyze policy
  withPolicyAnalysis: makeReport(highRiskScan, highRiskBreakdown, highRiskRecs, {
    policyAnalysis: MOCK_POLICY_ANALYSIS
  }),

  // High, with a policy summary that says almost nothing
  withVaguePolicy: makeReport(highRiskScan, highRiskBreakdown, highRiskRecs, {
    policyAnalysis: MOCK_POLICY_ANALYSIS_VAGUE
  }),

  // High, with a module that failed to respond
  withWarnings: makeReport(highRiskScan, highRiskBreakdown, highRiskRecs, {
    warnings: ["Tracker module did not respond. Tracker counts may be incomplete."]
  })
};

/* ---------- errors (docs/contract.md section 8) ---------- */

export const ERRORS = {
  restrictedPage: { error: true, code: "RESTRICTED_PAGE", message: "Extensions cannot run on this page." },
  timeout: { error: true, code: "SCAN_TIMEOUT", message: "A module did not respond in time." },
  backendDown: { error: true, code: "BACKEND_UNREACHABLE", message: "Could not reach the PrivacyGuard server." },
  policyFetchFailed: { error: true, code: "POLICY_FETCH_FAILED", message: "Policy page could not be fetched." },
  geminiFailed: { error: true, code: "GEMINI_FAILED", message: "AI analysis failed." },
  invalidInput: { error: true, code: "INVALID_INPUT", message: "Request did not match the contract." }
};

/* ---------- access helpers ---------- */

// Always return copies, so a test that edits a report never changes the shared mock.
export const getScenario = (name) => structuredClone(SCENARIOS[name]);
export const getError = (name) => structuredClone(ERRORS[name]);

// Older names, kept so existing imports keep working.
export const MOCK_REPORT = SCENARIOS.highRisk;
export const MOCK_SCAN = MOCK_REPORT.scan;
export const MOCK_RESULT = MOCK_REPORT.result;

/* ---------- consistency checker ---------- */

// Returns a list of problems. An empty list means the report follows the contract's numeric rules.
// Works on mock data and on real reports, so use it in tests and in integration.
export function assertConsistent(report) {
  const problems = [];
  const { scan, result } = report ?? {};
  if (!scan || !result) return ["Report needs both scan and result."];

  const types = scan.scanner?.fieldTypes ?? {};
  for (const k of FIELD_KEYS) {
    if (typeof types[k] !== "number") problems.push(`fieldTypes.${k} is missing or not a number`);
  }
  if (sum(types) !== scan.scanner?.personalDataFields) {
    problems.push(`personalDataFields (${scan.scanner?.personalDataFields}) does not equal the sum of fieldTypes (${sum(types)})`);
  }

  const c = scan.tracking?.cookies;
  if (!c || c.total !== c.firstParty + c.thirdParty) {
    problems.push("cookies.total does not equal firstParty + thirdParty");
  }

  for (const k of ["analytics", "advertising", "social", "unknown"]) {
    if (typeof scan.tracking?.trackers?.[k] !== "number") problems.push(`trackers.${k} is missing or not a number`);
  }

  if (scan.policy?.found && typeof scan.policy.url !== "string") {
    problems.push("policy.found is true but policy.url is not a string");
  }

  const total = result.breakdown ? sum(result.breakdown) : NaN;
  if (total !== result.riskScore) {
    problems.push(`riskScore (${result.riskScore}) does not equal the sum of breakdown (${total})`);
  }
  if (!(result.riskScore >= 0 && result.riskScore <= 100)) problems.push("riskScore must be between 0 and 100");
  if (result.riskLevel !== levelFromScore(result.riskScore)) {
    problems.push(`riskLevel "${result.riskLevel}" does not match score ${result.riskScore} (expected "${levelFromScore(result.riskScore)}")`);
  }
  return problems;
}