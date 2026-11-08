// Phase 1 mock reports matching backend/services/risk_engine.py. Owner: Tanishq.
const FIELD_KEYS = ["name", "email", "phone", "address", "dob", "password", "financial", "governmentId"];
const zeroFields = () => Object.fromEntries(FIELD_KEYS.map((key) => [key, 0]));
const trackerCounts = (overrides = {}) => ({ analytics: 0, advertising: 0, social: 0, unknown: 0, ...overrides });

const MOCK_TRACKER_DOMAINS = {
  analytics: ["google-analytics.com", "googletagmanager.com", "segment.com", "hotjar.com", "mixpanel.com"],
  advertising: ["doubleclick.net", "googlesyndication.com", "adnxs.com", "adsrvr.org", "facebook.net"],
  social: ["connect.facebook.net", "platform.twitter.com", "platform.linkedin.com", "platform.instagram.com"],
  unknown: ["cdn-telemetry.net", "collector-edge.io", "stats-pixel.org", "beacon-tracker.com"]
};

const MOCK_COOKIE_NAMES = {
  firstParty: ["_session_id", "csrf_token", "_ga", "_gid", "preferences", "user_jwt", "remember_me", "site_theme", "cart_id"],
  thirdParty: ["IDE", "test_cookie", "tuuid", "uid", "visitor_id", "anj", "bscookie", "li_sugr", "ad_track_id"]
};

export function levelFromScore(score) {
  if (score <= 25) return "Low";
  if (score <= 50) return "Moderate";
  if (score <= 75) return "High";
  return "Very High";
}

function makeReport({ hostname, path = "/", https = true, forms = 0, fields = {}, first = 0, third = 0, trackers = {}, scripts = 0, breakdown, recommendations, warnings = [] }) {
  const fieldTypes = { ...zeroFields(), ...fields };
  const score = breakdown.personalData + breakdown.trackers + breakdown.security;
  const scan = {
    url: `${https ? "https" : "http"}://${hostname}${path}`,
    hostname,
    scannedAt: "2026-10-21T10:00:00Z",
    https,
    scanner: { forms, personalDataFields: Object.values(fieldTypes).reduce((a, b) => a + b, 0), fieldTypes, fields: [] },
    tracking: {
      cookies: {
        total: first + third, firstParty: first, thirdParty: third,
        firstPartyList: Array.from({ length: first }, (_, i) => ({
          name: MOCK_COOKIE_NAMES.firstParty[i % MOCK_COOKIE_NAMES.firstParty.length] + (i >= MOCK_COOKIE_NAMES.firstParty.length ? `_${i + 1}` : ""),
          domain: hostname
        })),
        thirdPartyList: Array.from({ length: third }, (_, i) => ({
          name: MOCK_COOKIE_NAMES.thirdParty[i % MOCK_COOKIE_NAMES.thirdParty.length] + (i >= MOCK_COOKIE_NAMES.thirdParty.length ? `_${i + 1}` : ""),
          domain: MOCK_TRACKER_DOMAINS.advertising[i % MOCK_TRACKER_DOMAINS.advertising.length] || `tracker${i + 1}.example.com`
        }))
      },
      thirdPartyScripts: scripts,
      trackers: trackerCounts(trackers),
      trackerList: Object.entries(trackerCounts(trackers)).flatMap(([cat, count]) => {
        const pool = MOCK_TRACKER_DOMAINS[cat] || [];
        return Array.from({ length: count }, (_, i) => ({
          domain: pool[i % pool.length] || `${cat}${i + 1}.example.net`,
          category: cat
        }));
      })
    },
    policy: { found: false, url: null, candidates: [] }
  };
  return {
    scan,
    result: { id: `scan_mock_${hostname}`, url: scan.url, riskScore: score, riskLevel: levelFromScore(score), breakdown, recommendations },
    policyAnalysis: null,
    warnings
  };
}

export const MOCK_POLICY_ANALYSIS = { dataCollected: [], purposes: [], dataSharing: false, thirdParties: "", retention: "", deletion: "", concerns: [] };

export const SCENARIOS = {
  lowRisk: makeReport({ hostname: "quietnotes.example", forms: 1, fields: { email: 1 }, breakdown: { personalData: 1, trackers: 0, security: 0 }, recommendations: ["No notable privacy concerns were found on this page."] }),
  moderate: makeReport({ hostname: "greenbasket.example", path: "/signup", forms: 1, fields: { name: 1, email: 1, password: 1 }, first: 5, third: 2, trackers: { analytics: 2 }, scripts: 2, breakdown: { personalData: 5, trackers: 6, security: 0 }, recommendations: ["2 analytics tracker(s) found. These measure how you use the site."] }),
  highRisk: makeReport({ hostname: "example.com", path: "/login", forms: 3, fields: { name: 1, email: 2, phone: 1, address: 1, password: 1 }, first: 9, third: 5, trackers: { analytics: 3, advertising: 2, social: 1, unknown: 1 }, scripts: 6, breakdown: { personalData: 14, trackers: 25, security: 0 }, recommendations: ["2 advertising tracker(s) found. Consider a tracker blocker or declining non-essential cookies.", "5 third-party cookies are set. Consider blocking third-party cookies in your browser."] }),
  veryHigh: makeReport({ hostname: "bigdeals.example", path: "/checkout", https: false, forms: 1, fields: { email: 1, password: 1, financial: 2 }, first: 2, third: 8, trackers: { advertising: 6, unknown: 2 }, scripts: 8, breakdown: { personalData: 20, trackers: 40, security: 20 }, recommendations: ["This page is not secure (HTTP). Do not enter passwords or payment details here."] }),
  zeroData: makeReport({ hostname: "staticpage.example", breakdown: { personalData: 0, trackers: 0, security: 0 }, recommendations: ["No notable privacy concerns were found on this page."] }),
  withWarnings: makeReport({ hostname: "example.com", fields: { email: 1 }, breakdown: { personalData: 1, trackers: 0, security: 0 }, recommendations: ["No notable privacy concerns were found on this page."], warnings: ["Tracker scanner did not respond. Tracker counts may be incomplete."] })
};

export const ERRORS = {
  restrictedPage: { error: true, code: "RESTRICTED_PAGE", message: "Extensions cannot run on this page." },
  timeout: { error: true, code: "SCAN_TIMEOUT", message: "A module did not respond in time." },
  backendDown: { error: true, code: "BACKEND_UNREACHABLE", message: "Could not reach the PrivacyGuard server." },
  policyFetchFailed: { error: true, code: "POLICY_FETCH_FAILED", message: "Policy page could not be fetched." },
  geminiFailed: { error: true, code: "GEMINI_FAILED", message: "AI analysis is not part of Phase 1." },
  invalidInput: { error: true, code: "INVALID_INPUT", message: "Request did not match the contract." }
};

export const getScenario = (name) => structuredClone(SCENARIOS[name]);
export const getError = (name) => structuredClone(ERRORS[name]);
export const MOCK_REPORT = SCENARIOS.highRisk;
export const MOCK_SCAN = MOCK_REPORT.scan;
export const MOCK_RESULT = MOCK_REPORT.result;

export function assertConsistent(report) {
  const problems = [];
  const { scan, result } = report ?? {};
  if (!scan || !result) return ["Report needs both scan and result."];
  if (Object.values(scan.scanner?.fieldTypes ?? {}).reduce((a, b) => a + b, 0) !== scan.scanner?.personalDataFields) problems.push("personalDataFields does not equal the sum of fieldTypes");
  const cookies = scan.tracking?.cookies;
  if (!cookies || cookies.total !== cookies.firstParty + cookies.thirdParty) problems.push("cookies.total does not equal firstParty + thirdParty");
  const total = result.breakdown ? Object.values(result.breakdown).reduce((a, b) => a + b, 0) : NaN;
  if (total !== result.riskScore) problems.push("riskScore does not equal breakdown sum");
  if (result.riskLevel !== levelFromScore(result.riskScore)) problems.push("riskLevel does not match score");
  if (result.breakdown && Object.keys(result.breakdown).sort().join(",") !== "personalData,security,trackers") problems.push("Phase 1 breakdown must contain only personalData, trackers and security");
  return problems;
}
