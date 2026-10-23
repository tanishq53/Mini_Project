# PrivacyGuard security review checklist

Use this checklist for extension and backend pull requests.

- Does the change read form `.value`, passwords, credentials, cookies, or other user-entered content? If so, stop and redesign it.
- Are field classifications based on attributes and static accessible labels only?
- Does any log, error, report, or database write include raw request bodies, field values, cookies, bearer tokens, or full URLs with query strings?
- Does the change add a network request? Confirm the destination, HTTPS requirement, timeout, and exact data sent.
- Does it add or broaden a Chrome permission or host permission? Explain why each permission is needed.
- The current `<all_urls>` host access supports scanning arbitrary visited HTTP/S pages and reading their cookies. Any per-site permission redesign must preserve an explicit user-initiated permission flow.
- Are API routes protected by authentication when configured, request limits, input validation, and rate limits?
- Are CORS origins explicit? Does production fail closed without its API key, HTTPS, origin allowlist, and TLS database configuration?
- Are secrets stored outside source control? Never put an API key in extension source or logs.
- Do tests cover invalid URLs, oversized input, sensitive-field rejection, rate limits, and report access control?
- Were backend tests, scanner tests, and relevant manual Chrome checks run? Record exact commands and results.
