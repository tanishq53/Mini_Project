# PrivacyGuard backend

Owner: Sushanth. FastAPI server, Gemini integration, risk engine and database.

Endpoints and response formats are defined in [../docs/contract.md](../docs/contract.md) section 6.

Copy `.env.example` to `.env` and set `GOOGLE_SAFE_BROWSING_API_KEY` to enable the separate website reputation check. Keep the key in the backend environment; do not add it to the extension. The check sends the site's origin (scheme, domain, and port only) to Google Safe Browsing, not the page path, query, or fragment.

The check is separate from the privacy exposure score. "No known threats" is not a guarantee that a site or download is safe. Review Google's [Safe Browsing API usage requirements](https://developers.google.com/safe-browsing/v4/usage-limits) before deployment.
