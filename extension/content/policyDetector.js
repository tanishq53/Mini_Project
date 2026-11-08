// PrivacyGuard policy detector. Owner: Namitha K.
// Exposes window.__pgDetectPolicy() which is called by tracker.js during a scan.
// Returns the exact shape required by docs/contract.md §4.2:
//   { found: boolean, url: string|null, candidates: [{text, href}] }
// Does NOT read cookies, form values, passwords, or user-entered data.
// Discovery only. The visible-page analysis runs separately after a user request.

window.__pgDetectPolicy = function () {
  const candidates = [];
  const seen = new Set();

  const links = document.querySelectorAll("a[href]");

  for (const link of links) {
    // Collect visible text from multiple sources.
    // title attribute is checked last: it is a tooltip, not visible body text,
    // but some sites use it as the only accessible label on footer links.
    const text = (
      link.innerText ||
      link.getAttribute("aria-label") ||
      link.getAttribute("title") ||
      ""
    ).trim();

    const href = link.getAttribute("href");

    if (!href) {
      continue;
    }
    // In-page anchors inherit the current policy page's URL path. They are
    // navigation controls, not separate policy documents.
    if (/^[#?]/.test(href.trim())) continue;

    let url;
    try {
      url = new URL(href, window.location.href);
    } catch {
      continue;
    }

    if (!["http:", "https:"].includes(url.protocol)) {
      continue;
    }

    const description = text.toLowerCase();
    // Ignore search parameters and fragments. Login links often carry a return
    // URL containing "privacy-policy" but are not policy pages themselves.
    const urlPath = url.pathname.toLowerCase();

    const isPolicyLink =
      /privacy|cookie|\bpolicy\b|data protection|data processing|data retention|data policy|personal data|data use|information practices|do not sell|privacy choices|terms(?:\s+(?:and|&)\s+conditions)?|terms of service|user agreement|acceptable use|community guidelines|security policy|responsible disclosure|legal notice|disclaimer|copyright|refund|return policy|shipping policy|accessibility statement/.test(
        description + " " + urlPath
      );

    if (!isPolicyLink) {
      continue;
    }

    const key = `${url.origin.replace(/^https?:\/\/www\./i, "https://")}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push({
      text: text || "Privacy-related link",
      href: url.href
    });
  }

  // Rank candidates by relevance — three tiers, first match wins.
  //
  // Tier 1: link text is exactly a known policy label (highest confidence).
  //         e.g. <a>Privacy Policy</a>  or  <a>Privacy Notice</a>
  //
  // Tier 2: link text contains a known policy phrase (medium confidence).
  //         e.g. <a>Our Privacy Policy and Cookie Notice</a>
  //         or the URL itself contains "privacy-policy" and the text is generic
  //         like "Click here" — the href is concatenated so the regex can match it.
  //
  // Tier 3: the URL path clearly signals a privacy policy but the link text is
  //         vague.  e.g. <a href="/privacy-policy">Learn more</a>
  //         Only the href is tested so generic text alone cannot trigger this.

  const EXACT_LABEL = /^(privacy policy|privacy notice|privacy statement|data protection policy)$/i;
  const PHRASE_IN_TEXT_OR_HREF = /privacy policy|privacy notice|privacy statement|data protection policy/i;
  const POLICY_PATH = /\/privacy[\-_]?(?:policy|notice|statement)?(?:[\/?#]|$)|\bprivacy\.(?:html?|php|asp)(?:[?#]|$)/i;

  const bestMatch =
    candidates.find(c => EXACT_LABEL.test(c.text.trim())) ||
    candidates.find(c => PHRASE_IN_TEXT_OR_HREF.test(c.text + " " + c.href)) ||
    candidates.find(c => POLICY_PATH.test(c.href));

  return {
    found: Boolean(bestMatch),
    url: bestMatch ? bestMatch.href : null,
    candidates
  };
};
