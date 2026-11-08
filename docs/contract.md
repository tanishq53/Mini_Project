# PrivacyGuard Data Contract

**Version:** 1.5
**Maintainer:** Tanishq Gautam (integration)
**Status:** Frozen for development. Changes need team agreement (see section 9).

This document defines the JSON shapes and messages that connect every PrivacyGuard module. If your module follows this contract, it will plug into the rest of the system without changes.

## Phase scope

PrivacyGuard is built in two phases.

**Phase 1:** scan the page for forms, cookies, trackers and HTTP/HTTPS, and calculate the Privacy Risk Score. The scoring model is in `docs/scoring.md`. A separate optional Google Safe Browsing check reports known domain threats; it does not change the privacy score. Firebase Authentication and Cloud Firestore power the optional account dashboard and minimized scan history.

**Phase 2 (implemented):** discover privacy and legal links, and let the user analyze the current page or linked policy pages with Gemini. Analysis is informational and does not change the deterministic Privacy Risk Score.

The implemented Phase 2 uses these behaviors:

| Item | Behaviour |
|---|---|
| `policy` object (4.2, 5) | Reports discovered privacy links and related legal links. It is not used in the risk score. |
| `POST /analyze-policy` (6.3) | Accepts user-requested visible page text and returns a structured Gemini analysis. |
| `POST /analyze-policies` | Accepts up to 12 separately labeled policy excerpts (30,000 characters combined) and returns one report for each, in order. |
| `ANALYZE_POLICY` message (3) | Sent only when the user clicks **Analyze this page**. |
| `policyAnalysis` in the report (7) | Filled after a successful on-demand page analysis; never persisted in scan history. |
| `breakdown.policy` (6.1) | Not present. Risk breakdown remains the three deterministic components. |

Page or linked-policy analysis sends at most 30,000 characters of visible text to Google Gemini after an explicit button click. Linked pages are fetched without cookies; form controls and their values are excluded. Only the site origin, not page paths or query strings, is sent to Gemini. A valid extension connection key is required. Page text is not stored by PrivacyGuard. Treat the page as untrusted input; Gemini output is explanatory and may be incomplete.

## 1. Who owns what

| Module | Owner | Produces | Consumes |
|---|---|---|---|
| `scanner.js` (forms, personal data) | Varsha | `scanner` object | Page DOM |
| `tracker.js`, `policyDetector.js` | Namitha | `tracking` and `policy` objects | Page DOM, cookies (read by background) |
| FastAPI backend, Gemini, risk engine | Sushanth | Report response | Merged scan object |
| `background.js`, popup UI, integration | Tanishq | Merged scan object, rendered dashboard | Everything above |

## 2. Data flow

```
Popup  ->  background.js  ->  content scripts (scanner, tracker, policy)
                |                          |
                |<------ SCAN_RESULT ------|
                |
         merge + add cookies
                |
                v
         POST /scan  ->  FastAPI  ->  risk engine
                                 \->  Gemini (visible page analysis, on request)
                |
                v
         REPORT_READY  ->  Popup dashboard
Popup  ->  background.js  ->  POST /reputation -> Google Safe Browsing
```

## 3. Extension messages

All messages use `chrome.runtime.sendMessage` or `chrome.tabs.sendMessage`. Every message has a `type` string and an optional `payload`.

| Type | From | To | Payload | Reply |
|---|---|---|---|---|
| `START_SCAN` | popup | background | `{ tabId }` | The report (section 7), or an error object |
| `RUN_SCAN` | background | content scripts | `{}` | None. Content scripts answer with `SCAN_RESULT`. |
| `SCAN_RESULT` | content script | background | `{ source, data }` (see section 4) | None |
| `ANALYZE_POLICY` | popup | background | `{ tabId }` | The current-page analysis (section 6.3), or an error object |
| `CHECK_REPUTATION` | popup | background | `{ url }` | Reputation result (section 6.2) |
| `PAGE_CHANGED` | content script | background | `{ url, reason }` | None |
| `SCAN_STARTED` | background | popup | `{ tabId, url }` | None |
| `REPORT_READY` | background | popup | `{ tabId, report }` | None |
| `SCAN_ERROR` | background | popup | `{ tabId, error }` | None |
| `PING` | any | background | `{}` | `{ ok: true }` |

`source` in `SCAN_RESULT` is either `"scanner"` or `"tracker"`, so background knows which part it received.

`reason` in `PAGE_CHANGED` is `"url"` (address changed without a reload) or `"content"` (new content appeared). Background decides whether to rescan.

`START_SCAN` and `ANALYZE_POLICY` are answered directly with their result. `SCAN_STARTED`, `REPORT_READY` and `SCAN_ERROR` are pushed to the popup only for automatic rescans the popup did not ask for. The popup ignores pushes whose `tabId` is not the active tab.

Content script authors (Varsha, Namitha) only need `RUN_SCAN` (listen) and `SCAN_RESULT` (send). The rest is handled by Tanishq.

## 4. Content script output

### 4.1 Varsha: `scanner` object

Sent as `SCAN_RESULT` with `source: "scanner"`.

```json
{
  "forms": 3,
  "personalDataFields": 7,
  "fieldTypes": {
    "name": 1,
    "email": 2,
    "phone": 1,
    "address": 1,
    "dob": 0,
    "password": 1,
    "financial": 0,
    "governmentId": 0
  },
  "fields": [
    { "category": "email", "name": "user_email", "type": "email", "formIndex": 0 }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `forms` | integer | Number of `<form>` elements, plus form-like input groups if you detect them |
| `personalDataFields` | integer | Sum of all `fieldTypes` values. Must match. |
| `fieldTypes` | object | All keys must always be present, with 0 when none found |
| `fields` | array | Optional detail list. Do not include values typed by the user. |

Privacy rule: never read or send what the user typed into any field. Detect field types from attributes only (`type`, `name`, `id`, `placeholder`, `autocomplete`, label text).

### 4.2 Namitha: `tracking` and `policy` objects

Sent as `SCAN_RESULT` with `source: "tracker"`. The payload contains both objects.

```json
{
  "tracking": {
    "thirdPartyScripts": 7,
    "trackers": {
      "analytics": 3,
      "advertising": 2,
      "social": 1,
      "unknown": 1
    },
    "trackerList": [
      { "domain": "google-analytics.com", "category": "analytics" }
    ]
  },
  "policy": {
    "found": true,
    "url": "https://example.com/privacy",
    "candidates": [
      { "text": "Privacy Policy", "href": "https://example.com/privacy" },
      { "text": "Cookie Policy", "href": "https://example.com/cookies" }
    ]
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `trackers.*` | integer | Known services only go in analytics, advertising or social. Unrecognised third-party scripts go in `unknown`. |
| `trackerList` | array | Optional, used for the details view. When present, it must match `thirdPartyScripts` and each category count. |
| `policy.found` | boolean | True if at least one confident privacy policy link exists |
| `policy.url` | string or null | Best match. `null` if not found. |
| `policy.candidates` | array | All privacy-related links. Used for the "possible links" fallback when `found` is false. |

Cookies are not part of this object. Content scripts cannot read cookies, so background reads them (section 5).

## 5. Merged scan object (background to backend)

Built by `background.js`. Sent as the body of `POST /scan`.

```json
{
  "url": "https://example.com/login",
  "hostname": "example.com",
  "scannedAt": "2026-10-02T10:00:00Z",
  "https": true,
  "scanner": { },
  "tracking": {
    "cookies": { "total": 14, "firstParty": 9, "thirdParty": 5 },
    "thirdPartyScripts": 7,
    "trackers": { "analytics": 3, "advertising": 2, "social": 1, "unknown": 1 }
  },
  "policy": { }
}
```

`scanner` and `policy` are copied unchanged from sections 4.1 and 4.2. `tracking.cookies` is added by background using `chrome.cookies`.
`thirdPartyScripts` counts unique script hostnames and equals the sum of the four tracker categories.

`https` reports the URL scheme only. The backend adds a `tls` result (`secure`, `insecure`, `broken`, or `null`) to the `/scan` response after a certificate-validating TLS handshake on port 443. The handshake sends the hostname for SNI but no HTTP request, path, cookies, or form data. `secure` means the backend's trust store accepted the certificate and hostname; it does not report Chrome's address-bar state or detect mixed content. `insecure` means certificate verification failed, `broken` means TLS negotiation failed, and `null` means the backend could not make a reliable check. The backend checks only local extension requests; it checks private/LAN destinations only when the URL contains an explicit IP address, preventing DNS rebinding through a public hostname. Do not expose the development server through a network proxy. An `insecure` or `broken` TLS state contributes to the security score like an HTTP connection.

The local report also retains `tracking.trackerList` and cookie details (`firstPartyList` and `thirdPartyList`, each containing only cookie `name` and `domain`) for the popup's expandable details. Cookie values are never read. These details are excluded from the `POST /scan` request; the backend receives cookie counts and tracker category counts only.

Defaults: if a module fails or does not respond, background fills its section with zeros (or `found: false` for policy) and adds a warning, rather than blocking the scan.

## 6. Backend API (Sushanth)

Base URL in development: `http://localhost:8000`

### 6.1 `POST /scan`

Request: merged scan object (section 5).

Response:

```json
{
  "id": "scan_abc123",
  "url": "https://example.com/login",
  "tls": "secure",
  "riskScore": 39,
  "riskLevel": "Moderate",
  "breakdown": {
    "personalData": 14,
    "trackers": 25,
    "security": 0
  },
  "recommendations": [
    "2 advertising tracker(s) found. Consider a tracker blocker or declining non-essential cookies.",
    "5 third-party cookies are set. Consider blocking third-party cookies in your browser."
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `tls` | string or null | Backend certificate check: `secure`, `insecure`, `broken`, or `null` if it could not check. |
| `riskScore` | integer | 0 to 100 |
| `riskLevel` | string | One of `"Low"`, `"Moderate"`, `"High"`, `"Very High"` |
| `breakdown` | object | `personalData`, `trackers` (includes cookies), and `security`. Must sum exactly to `riskScore`; page analysis does not change it. |
| `recommendations` | array of strings | Plain language, rule-based, at most 5, most serious first. Must work without Gemini. |

The score is calculated by the formula in `docs/scoring.md`. Reference implementation: `backend/services/risk_engine.py`.

### 6.2 `POST /reputation`

Checks the current page URL with Google Safe Browsing, independently of the privacy score. The backend sends the URL's origin and path to Google. Query strings and fragments are excluded to avoid sending potentially sensitive URL data.

Request:

```json
{ "url": "https://example.com/account?private=value" }
```

Response status is `safe`, `unsafe`, `not_configured`, or `unavailable`. Unsafe responses include recognized `threatTypes` (`MALWARE`, `SOCIAL_ENGINEERING`, or `UNWANTED_SOFTWARE`). The backend needs `GOOGLE_SAFE_BROWSING_API_KEY` configured in its environment. It does not store reputation requests or results.

This check identifies URLs listed by Google as known threats; a clean result does not guarantee the site or its downloads are safe. The checked URL's origin and path are disclosed to Google. Follow Google's Safe Browsing API terms and usage requirements before deployment.

Risk levels (proposed project thresholds, not an official standard):

| Score | Level | UI colour |
|---|---|---|
| 0 to 25 | Low | Green |
| 26 to 50 | Moderate | Yellow |
| 51 to 75 | High | Orange |
| 76 to 100 | Very High | Red |

### 6.3 `POST /analyze-policy` (Phase 2)

Triggered only when the user clicks **Analyze this page**.

Request:

```json
{ "url": "https://example.com", "pageText": "Visible text from the current page, up to 30000 characters" }
```

`url` is limited to the page origin. The extension reads visible text from the current tab only after the user clicks Analyze this page. It excludes form controls and their values and does not crawl other pages. A valid extension connection key and `GEMINI_API_KEY` are required. This endpoint does not store the submitted text.

Response:

```json
{
  "pageType": "Privacy notice",
  "summary": "Summary grounded in the supplied page excerpt.",
  "keyPoints": ["The page describes account data use."],
  "privacySignals": ["Analytics are mentioned."],
  "policyDetails": {
    "dataCollected": ["Email"], "purposes": ["Account creation"],
    "dataSharing": "Unclear", "thirdParties": "Not stated in this page",
    "retention": "Not stated in this page", "deletion": "Not stated in this page",
    "concerns": []
  }
}
```

The same response shape is used for any page type. The model must not follow instructions found in page text or infer policy details that the text does not support. Gemini failures return a normal error response; the scan score still works without this endpoint.

### 6.3.1 `POST /analyze-policies`

Triggered only after the user clicks **Analyze found policies**. The panel first lists every detected link, then shows a separate report for each readable policy, in link order, in the scrollable report dialog. The extension fetches linked HTML without cookies, removes form controls and hidden/script content, and sends at most 30,000 characters across up to 12 policy excerpts per request. Policy paths and query strings are not sent to Gemini. Unreadable pages receive their own unavailable section; one failed link does not hide the remaining reports. The panel's **+** button opens the dialog once at least one report or unavailable result exists.

Request:

```json
{
  "origin": "https://example.com",
  "documents": [
    { "label": "Privacy policy", "pageText": "Visible policy text..." },
    { "label": "Cookie policy", "pageText": "Visible cookie notice text..." }
  ]
}
```

The response is `{ "origin": "https://example.com", "reports": [ ... ] }`, where `reports` uses the same analysis shape as section 6.3 and preserves input order. Authentication and `GEMINI_API_KEY` are required. Submitted text is not persisted.

### 6.4 `GET /report/{id}`

Returns the stored scan result for the given `id`. On-demand page analysis is held only in the extension's current report and is not stored by this endpoint.

### 6.5 Firebase account dashboard and visit history

The FastAPI app serves the account dashboard at `/`. The website uses Firebase Authentication email/password sign-in. Firebase ID tokens are sent as Bearer tokens and verified by the Firebase Admin SDK before protected endpoints return or change account data. `GET /api/firebase-config` exposes only the public Firebase Web App configuration; Admin credentials are never served to the browser.

The signed-in dashboard can create/revoke one extension connection key (`POST`/`DELETE /api/extension-key`); only its SHA-256 hash is stored in Firestore. The user pastes the one-time key into PrivacyGuard's extension options. A scan with a valid bearer key is added to that account; scans without a key continue to work but do not create account history. `GET /api/history?period=day|week|month` returns an aggregate view for the last 1, 7, or 30 days. `DELETE /api/history` clears only that account's history.

Firestore stores each history record below `users/{uid}/visits/` with only hostname, server timestamp, risk score/level, and TLS result. It does not store page paths, query strings, form contents, or cookie values. Account history begins only after the user connects the extension; they can disconnect it and clear saved records from the dashboard. The browser does not access Firestore directly; `firestore.rules` denies client access, while the trusted backend uses the Admin SDK. Existing local SQLite account/history data is not migrated automatically.

## 7. Final report object (backend to popup)

This object is the reply to `START_SCAN` and the payload of `REPORT_READY`. It is assembled by background:

```json
{
  "scan": { },
  "result": { },
  "policyAnalysis": null,
  "warnings": []
}
```

- `scan` is the merged scan object (section 5), with `tls` added from the backend response.
- `result` is the `/scan` response (section 6.1).
- `policyAnalysis` stays `null` until the user runs **Analyze this page**, then holds the `/analyze-policy` response in the current report only.
- `warnings` is an array of strings, such as "Tracker module did not respond".

## 8. Error format

All errors, from any module or the backend, use this shape:

```json
{
  "error": true,
  "code": "BACKEND_UNREACHABLE",
  "message": "Could not reach the PrivacyGuard server."
}
```

| Code | Meaning |
|---|---|
| `RESTRICTED_PAGE` | Page type where extensions cannot run (for example `chrome://` pages) |
| `SCAN_TIMEOUT` | A module did not respond in time (default 10 seconds) |
| `BACKEND_UNREACHABLE` | FastAPI is not running or the request failed |
| `POLICY_FETCH_FAILED` | Policy page could not be fetched |
| `GEMINI_FAILED` | AI analysis failed or timed out |
| `EXTENSION_AUTH_REQUIRED` | No valid Firebase connection key is saved in extension options |
| `INVALID_INPUT` | Request did not match this contract |
| `AUTH_REQUIRED` | A valid bearer token is required when API authentication is enabled |
| `RATE_LIMITED` | The caller exceeded the configured API request limit |
| `PAYLOAD_TOO_LARGE` | The scan request exceeded the configured byte limit |
| `HTTPS_REQUIRED` | Production API was reached without HTTPS |
| `SERVER_MISCONFIGURED` | API key or required production security configuration is missing |

Backend errors use the same body shape with HTTP 400 for invalid input, 401 for missing or invalid authentication, 403 for HTTPS enforcement, 413 for oversized requests, 429 for rate limits, 500 for server errors, 503 for missing security configuration, and 502 or 504 for future Gemini failures.

## 9. Rules for everyone

1. Field names are case-sensitive and use camelCase.
2. Always return every field in your section, using `0`, `false`, `null` or `[]` when there is nothing to report. Do not omit keys.
3. Never collect, store or send what the user types into forms, or any passwords or credentials.
4. Never click buttons or submit forms automatically. Scanning is read-only.
5. Core detection and scoring must work without Gemini. Gemini is used only for on-demand visible-page analysis.
6. Test your module with the mock data in `extension/mockData.js` before integrating.

## 10. Changing the contract

1. Open a GitHub issue titled `Contract change: <field>`, describing what and why.
2. Get a thumbs-up from the owner of every module that reads or writes that field.
3. Update this file and bump the version (1.0 to 1.1 for additions, 2.0 for breaking changes).
4. Tell the team in the group chat before merging.

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-02 | Initial contract |
| 1.1 | 2026-10-03 | Messages: added reply column, `PAGE_CHANGED`, `SCAN_STARTED`, `PING`. `START_SCAN` and `ANALYZE_POLICY` are answered directly; `REPORT_READY` and `SCAN_ERROR` are only pushed for automatic rescans. No change to any module's output. |
| 1.2 | 2026-10-03 | Added Phase scope section. Phase 1 has no policy analysis. `breakdown` has three keys (`personalData`, `trackers`, `security`) and sums exactly to `riskScore`. `/analyze-policy` marked Phase 2. Scoring model referenced in `docs/scoring.md`. Content-script output formats unchanged. |
| 1.3 | 2026-11-02 | Added backend TLS certificate verification to distinguish HTTPS URLs from verified TLS connections. |
| 1.4 | 2026-11-03 | Added a local account dashboard, SQLite-backed domain-only visit history, extension account keys, and day/week/month history views. |
| 1.5 | 2026-11-03 | Replaced dashboard account authentication and history storage with Firebase Authentication and Cloud Firestore. |
| 1.6 | 2026-11-08 | Added strict request validation, API hardening, and production deployment requirements while retaining Firebase accounts and policy-analysis endpoints. |
