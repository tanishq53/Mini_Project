# PrivacyGuard scoring model (Phase 1)

Status: proposed. The team should confirm the weights. They live as named constants at the top of
`backend/services/risk_engine.py`.

## What the score means

The score is a **privacy exposure score** from 0 to 100. It measures how much personal data a page asks for
and how many other parties or insecure connections are involved. It is **not** a trust rating: a well-known
company can have a high exposure score (many trackers), and a small unknown site can have a low one. The
tool is an awareness and screening aid, not a legal compliance check.

    riskScore = personalData + trackers + security

Each part is capped and the caps add up to 100. All weights are whole numbers. The three breakdown values
always add up exactly to riskScore.

## Personal data (max 25)

Points per detected field: name 1, email 2, password 2, phone 3, address 4, dob 4, financial 8, governmentId 10.

    personalData = min(25, points)

**Context rule.** Typed data is only really exposed when other parties can see it. Points count in full when
any of these is true:

- the page is explicitly not HTTPS (`https: false`),
- at least one known tracker (analytics, advertising or social) is present,
- at least one third-party cookie is present.

Otherwise (a clean HTTPS page) the points count at half, rounded up, so one detected field still adds 1.
Unknown third-party scripts do not remove the discount, because not every third-party script is a tracker
(fonts and CDNs are not). A missing `https` value is treated as secure.

Why: asking for an email address on a secure page with nobody else watching is ordinary. The same field on
an insecure page, or on a page full of trackers, is not.

## Trackers and cookies (max 55)

- Trackers, max 45: analytics 2, advertising 5, social 3, unknown 1 (per tracker).
- Cookies, max 10: 1 point per third-party cookie. First-party cookies are not scored.
- `breakdown.trackers = min(45, tracker points) + min(10, third-party cookies)`

`thirdPartyScripts` is shown in the panel but not scored.

A site's own domains (for example amazon.com and media-amazon.com) are not counted as third parties.

## Security (max 20)

- Page is not HTTPS: 12.
- Not HTTPS and the page has a password, financial or governmentId field: 8 more.

## Levels (proposed thresholds, not an official standard)

0 to 25 Low | 26 to 50 Moderate | 51 to 75 High | 76 to 100 Very High

The panel shows them as "Low exposure", "Moderate exposure", "High exposure" and "Very high exposure".
The API values stay "Low", "Moderate", "High" and "Very High".

## Worked examples

| Page | Personal data | Trackers | Security | Score |
|---|---|---|---|---|
| HTTP sign-up, 5 fields incl. password | 12 | 0 | 20 | 32 Moderate |
| HTTPS checkout, 9 sensitive fields, no trackers | 20 (half of 40) | 0 | 0 | 20 Low |
| Same checkout with 3 analytics trackers | 25 (full, capped) | 6 | 0 | 31 Moderate |
| HTTPS news page, no forms, ads and analytics | 0 | up to 55 | 0 | up to 55 |

## Known limits

- Password or sensitive fields over HTTP with nothing else wrong score 22 (Low) when only a password
  field is present. The panel still shows the "Do not enter passwords here" recommendation. Open decision.
- The model does not read the privacy policy. That is Phase 2.