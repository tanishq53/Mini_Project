# PrivacyGuard backend

Owner: Sushanth. FastAPI server, Gemini integration, risk engine and database.

Endpoints and response formats are defined in [../docs/contract.md](../docs/contract.md) section 6.

## Firebase dashboard setup

The account website uses Firebase Authentication (email/password) and Cloud Firestore. Firebase
Admin verifies ID tokens on the backend; account visit records are stored under
`users/{uid}/visits/`. Existing local SQLite account/history records are not migrated automatically.
The Firebase Web API key and app identifiers are public client configuration; keep the Admin SDK
service-account JSON private and outside this repository.

1. In the [Firebase Console](https://console.firebase.google.com/), create or open a project and
   register a Web app. Enable **Authentication → Email/Password** and create a **Cloud Firestore**
   database. Under **Authentication → Settings → Authorized domains**, add `localhost` for local
   development if it is not already listed; recent Firebase projects may not include it by default.
2. Copy `backend/.env.example` to `backend/.env`. Fill in the Web app's `FIREBASE_PROJECT_ID`,
   `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, and `FIREBASE_APP_ID` values.
3. For local backend access, create a Firebase service-account JSON key and keep that file outside
   this repository. Set `GOOGLE_APPLICATION_CREDENTIALS` in `backend/.env` to its path. Never commit
   or share the private JSON key. On Google Cloud, use Application Default Credentials instead.
4. Install dependencies with `pip install -r requirements.txt`, then run
   `uvicorn main:app --reload --port 8000` from this folder.
5. Open `http://localhost:8000/`, create an account, and verify the email Firebase sends. Choose
   **Create connection key**, then open `chrome://extensions` → PrivacyGuard **Details** →
   **Extension options** and paste the key.
6. Deploy the restrictive Firestore rules from the repository root with
   `firebase deploy --only firestore:rules` after selecting your Firebase project in the Firebase CLI.

Only scans sent with the extension key are added to the account. History stores site domains, times,
risk summaries, and TLS state; it omits URL paths, query strings, form contents, and cookie values.
The dashboard can revoke the extension key and clear saved history. The Admin SDK bypasses Firestore
Security Rules, so backend IAM credentials must remain private; browser clients are denied direct
Firestore access by `firestore.rules`.

For HTTPS scans, `/scan` performs a certificate-validating TLS handshake and returns `tls` as
`secure`, `insecure`, `broken`, or `null` when it cannot check reliably. The handshake sends no
HTTP request or page data. It runs only for requests from the local PrivacyGuard Chrome extension;
the development server should not be exposed through a proxy or to the network. Private/LAN
destinations are checked only when the URL uses an explicit IP address. Restart the backend
after changing code, then reload the unpacked extension from `chrome://extensions`.

Copy `.env.example` to `.env` and set `GOOGLE_SAFE_BROWSING_API_KEY` to enable the separate website reputation check. Keep the key in the backend environment; do not add it to the extension. The check sends the current page URL's origin and path to Google Safe Browsing. Query strings and URL fragments are excluded. TLS verification is performed by the backend itself, not Google Safe Browsing.

The check is separate from the privacy exposure score. "No known threats" is not a guarantee that a site or download is safe. Review Google's [Safe Browsing API usage requirements](https://developers.google.com/safe-browsing/v4/usage-limits) before deployment.

Set `GEMINI_API_KEY` in `backend/.env` to enable **Analyze this page** in the extension. Sign in to the dashboard, create a connection key, and save it in the extension options. Analysis starts only after the user clicks the button. The extension sends up to 30,000 characters of visible text from the current tab to Gemini; form controls and values, cookies, and URL paths are excluded. The backend does not save the submitted text. Analysis covers ordinary pages as well as policy/legal pages and does not change the risk score. The default model is `gemini-3.5-flash-lite`, selected for low latency; `GEMINI_MODEL` can override it.
