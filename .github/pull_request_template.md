## Summary

<!-- What changed and why? -->

## Verification

- [ ] Backend tests run (`python -m pytest -q` from `backend`)
- [ ] Relevant extension tests/manual checks recorded

## Security review

- [ ] Does this change read form values, passwords, credentials, or cookies?
- [ ] Does it send data outside the extension/backend? Which fields and destination?
- [ ] Does it add or broaden Chrome permissions or host access?
- [ ] Is page scanning still read-only?
- [ ] Are request validation, auth, logging, retention, and error handling appropriate?
- [ ] Did I add or change any secrets, network requests, or third-party dependencies?

See [the full security checklist](../docs/security-review-checklist.md).
