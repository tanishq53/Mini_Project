# Contributing to PrivacyGuard

## Branches

`main` always contains working, tested code. Nobody pushes to it directly.

| Person | Branch | Files they edit |
|---|---|---|
| Varsha | `feature/varsha-scanner` | `extension/content/scanner.js` |
| Namitha | `feature/namitha-trackers` | `extension/content/tracker.js`, `extension/content/policyDetector.js` |
| Sushanth | `feature/sushanth-backend` | everything in `backend/` |
| Tanishq | `feature/tanishq-extension` | `extension/manifest.json`, `extension/background/`, `extension/popup/`, `extension/utils/`, `docs/`, `test-pages/` |

Stick to your own files so merges stay conflict-free. `manifest.json` is owned by Tanishq: if you need a new permission or file listed, message him or open an issue.

## Workflow

1. Update `main` and create your branch from it (once):
   ```
   git checkout main
   git pull origin main
   git checkout -b feature/<name>-<module>
   ```
2. Work and commit often with clear messages.
3. Push your branch: `git push origin feature/<name>-<module>`
4. Open a pull request into `main`. Tanishq reviews and merges.
5. After a merge, pull `main` into your branch:
   ```
   git checkout feature/<name>-<module>
   git pull origin main
   ```

Merge at least once a week. Long-lived branches cause painful conflicts.

## Commit messages

Use the pattern `module: what changed`.

```
scanner: detect phone and DOB fields
tracker: classify Google Analytics as analytics
backend: add /scan endpoint
popup: show risk score ring
```

## The contract

All modules must follow [docs/contract.md](docs/contract.md). Do not rename or remove fields. To change it, open an issue titled `Contract change: <field>` and get agreement from every affected owner.

## Rules

- Never commit secrets. API keys and database URLs go in `.env` (ignored by git). Commit only `.env.example` with placeholder values.
- Never read, store or send what a user types into forms, or any passwords or credentials.
- Scanning is read-only. Never click buttons or submit forms automatically.
- Core detection must work without Gemini.
