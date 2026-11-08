# Phase 1 manual test cases

Serve `test-pages/` over HTTP (for example `python -m http.server 5500` from that folder), run the backend, and load `extension/` unpacked in Chrome. Expected scores use the current proposed model in `docs/scoring.md`.

| Case | Page/action | Expected result |
|---|---|---|
| Empty page | `simple.html` | 0 forms, 0 fields, no trackers; HTTP security breakdown 12, score 12 (Low). |
| Personal data, no known trackers | `no-policy.html` | 1 form, email 1 and phone 1; personal data 5, security 12, score 17 (Low). |
| Many forms | `many-forms.html` | 3 forms and 9 classified fields; personal-data component capped at 25, security 20 because sensitive fields are on HTTP (score 45). |
| Scanner edge cases | `scanner-edge-cases.html` | Initially governmentId 1, name 1, phone 1 and dob 1; `company_name` is ignored. Click Add a late email field and confirm email becomes 1. |
| Many trackers | `many-trackers.html` | No fields; analytics 3, advertising 2, social 1, unknown 1; tracker points 20 plus HTTP security 12 (score 32 before cookies). |
| SPA route | `spa-navigation.html`, click Change route | Current page gets rescanned once after the URL changes without a reload. |
| SPA content | Click Add email field | Rescan reflects one form and one email field; no repeated scans while the page is idle. |
| Standard form page | `login-with-policy.html` | 1 form and 5 fields (name, email, phone, address, password); HTTP security 20, personal data 12, score 32. |
| Backend down | Stop FastAPI, then scan | Side panel shows a backend connection error; extension remains usable. |
| Restricted page | Open a `chrome://` page and open panel | Clear restricted-page error; no scan is sent. |

Phase 2 policy detection and Gemini cases are intentionally omitted.

The scanner sees the document in the frame where Chrome injects it. The current manifest does not inject into every iframe, so fields inside other frames are not included in the scan.
