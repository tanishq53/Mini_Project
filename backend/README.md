# PrivacyGuard backend

Owner: Sushanth. FastAPI server, Gemini integration, risk engine and database.

Endpoints and response formats are defined in [../docs/contract.md](../docs/contract.md) section 6.

Copy `.env.example` to `.env` and set `GOOGLE_SAFE_BROWSING_API_KEY` to enable the separate website reputation check. Keep the key in the backend environment; do not add it to the extension. The check sends the current page URL's origin and path to Google Safe Browsing. Query strings and URL fragments are excluded.

The check is separate from the privacy exposure score. "No known threats" is not a guarantee that a site or download is safe. Review Google's [Safe Browsing API usage requirements](https://developers.google.com/safe-browsing/v4/usage-limits) before deployment.
