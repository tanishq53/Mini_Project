# PrivacyGuard

A Chrome extension that analyzes the privacy risks of the website you are visiting.

PrivacyGuard scans the current page for personal-data forms, cookies, third-party trackers and privacy-policy links, sends the findings to a FastAPI backend, and shows a Privacy Risk Score (0 to 100) with recommendations. An AI summary of the privacy policy is generated on request using the Gemini API.

PrivacyGuard is an awareness and screening tool. It does not guarantee detection of every privacy issue and is not a legal compliance check.

## Features

- Detects forms and personal-data input fields (name, email, phone, address, date of birth, password and more)
- Detects cookies, third-party scripts and known trackers
- Finds privacy-policy links, including after navigating to a login or signup page
- Calculates a Privacy Risk Score and risk level
- AI-generated privacy-policy summary (on request)
- Read-only scanning: it never clicks buttons, submits forms, or collects what you type

## Project structure

```
PrivacyGuard/
├── extension/     Chrome extension (Manifest V3)
├── backend/       FastAPI backend, Gemini, risk engine
├── test-pages/    Local pages for repeatable testing
└── docs/          Contract, architecture, testing, screenshots
```

The data formats shared between modules are defined in [docs/contract.md](docs/contract.md).

## Install the extension (from GitHub)

1. Click Code, then Download ZIP, and extract it (or clone the repo).
2. Open Chrome and go to `chrome://extensions`.
3. Turn on Developer mode (top right).
4. Click Load unpacked and select the `extension` folder.
5. Pin PrivacyGuard from the puzzle-piece menu. Clicking its icon opens the side panel.

After changing code, click the refresh icon on the PrivacyGuard card in `chrome://extensions`.

## Run the backend

The backend setup is documented in [backend/README.md](backend/README.md). By default the extension expects the server at `http://localhost:8000` (change it in `extension/utils/config.js`).

## Team

| Member | Module |
|---|---|
| Varsha N G | Website scanner and personal-data detection |
| Namitha K | Cookies, trackers and privacy-policy discovery |
| Sushanth A | Backend, Gemini, risk engine, database |
| Tanishq Gautam | Extension UI, integration and testing |

Contributing rules and the branch workflow are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Status

Phase 1: project skeleton. Modules are stubs that return empty results in the format defined in the contract.

## License

MIT. See [LICENSE](LICENSE).
