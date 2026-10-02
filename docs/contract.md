# PrivacyGuard Data Contract

**Version:** 1.0
**Maintainer:** Tanishq Gautam (integration)
**Status:** Frozen for development. Changes need team agreement (see section 9).

This document defines the JSON shapes and messages that connect every PrivacyGuard module. If your module follows this contract, it will plug into the rest of the system without changes.

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
                                 \->  Gemini (policy only, on request)
                |
                v
         REPORT_READY  ->  Popup dashboard
```

## 3. Extension messages

All messages use `chrome.runtime.sendMessage` or `chrome.tabs.sendMessage`. Every message has a `type` string and an optional `payload`.

| Type | From | To | Payload |
|---|---|---|---|
| `START_SCAN` | popup | background | `{ tabId }` |
| `RUN_SCAN` | background | content scripts | `{}` |
| `SCAN_RESULT` | content script | background | `{ source, data }` (see section 4) |
| `ANALYZE_POLICY` | popup | background | `{ tabId, policyUrl }` |
| `REPORT_READY` | background | popup | Report object (section 6) |
| `SCAN_ERROR` | any | popup | Error object (section 8) |

`source` in `SCAN_RESULT` is either `"scanner"` or `"tracker"`, so background knows which part it received.

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
    "thirdPartyScripts": 6,
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
| `trackerList` | array | Optional, used for the details view |
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
    "thirdPartyScripts": 6,
    "trackers": { "analytics": 3, "advertising": 2, "social": 1, "unknown": 1 }
  },
  "policy": { }
}
```

`scanner` and `policy` are copied unchanged from sections 4.1 and 4.2. `tracking.cookies` is added by background using `chrome.cookies`.

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
  "riskScore": 67,
  "riskLevel": "High",
  "breakdown": {
    "personalData": 25,
    "trackers": 15,
    "security": 10,
    "policy": 8
  },
  "recommendations": [
    "Review third-party tracking before signing up.",
    "Check the privacy policy for data deletion information."
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `riskScore` | integer | 0 to 100 |
| `riskLevel` | string | One of `"Low"`, `"Moderate"`, `"High"`, `"Very High"` |
| `breakdown` | object | Component scores. Should sum to `riskScore`. |
| `recommendations` | array of strings | Plain language, rule-based. Must work without Gemini. |

Risk levels (proposed project thresholds, not an official standard):

| Score | Level | UI colour |
|---|---|---|
| 0 to 25 | Low | Green |
| 26 to 50 | Moderate | Yellow |
| 51 to 75 | High | Orange |
| 76 to 100 | Very High | Red |

### 6.2 `POST /analyze-policy`

Triggered only when the user clicks Analyze Policy.

Request:

```json
{ "url": "https://example.com", "policyUrl": "https://example.com/privacy", "policyText": "..." }
```

`policyText` is optional. If background could not fetch the text, the backend may fetch `policyUrl` itself.

Response:

```json
{
  "dataCollected": ["Email", "Phone number", "Device information"],
  "purposes": ["Account creation", "Analytics"],
  "dataSharing": true,
  "thirdParties": "Service providers and advertising partners mentioned",
  "retention": "Not clearly specified",
  "deletion": "Users can request deletion by email",
  "concerns": ["Retention period is not stated"]
}
```

Rules:
- Every key must be present. Use `"Not specified"` or an empty array when the policy does not say.
- `dataSharing` is a boolean.
- Gemini failure must return a normal error object (section 8), not a crash. The scan score still works without this endpoint.

### 6.3 `GET /report/{id}`

Returns the stored scan result and policy analysis (if one exists) for the given `id`. Used for history and re-scan comparison.

## 7. Final report object (backend to popup)

`REPORT_READY` carries this object, assembled by background:

```json
{
  "scan": { },
  "result": { },
  "policyAnalysis": null,
  "warnings": []
}
```

- `scan` is the merged scan object (section 5).
- `result` is the `/scan` response (section 6.1).
- `policyAnalysis` is `null` until the user runs Analyze Policy, then the `/analyze-policy` response.
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
| `INVALID_INPUT` | Request did not match this contract |

Backend errors should use HTTP status codes (400 for invalid input, 500 for server errors, 502 or 504 for Gemini failures) with the body above.

## 9. Rules for everyone

1. Field names are case-sensitive and use camelCase.
2. Always return every field in your section, using `0`, `false`, `null` or `[]` when there is nothing to report. Do not omit keys.
3. Never collect, store or send what the user types into forms, or any passwords or credentials.
4. Never click buttons or submit forms automatically. Scanning is read-only.
5. Core detection must work without Gemini. Gemini is only used for policy summaries and explanations.
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
