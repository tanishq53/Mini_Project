// PrivacyGuard policy detector. Owner: Namitha K.
// Exposes window.__pgDetectPolicy() which is called by tracker.js during a scan.
// Returns the exact shape required by docs/contract.md §4.2:
//   { found: boolean, url: string|null, candidates: [{text, href}] }
// Does NOT read cookies, form values, passwords, or user-entered data.
// Does NOT call the backend or implement Gemini features.

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

    const description = text.toLowerCase();
    const urlText = href.toLowerCase();

    const isPolicyLink =
      /privacy|cookie|data protection|data policy|personal data/.test(
        description + " " + urlText
      );

    if (!isPolicyLink) {
      continue;
    }

    try {
      const url = new URL(href, window.location.href);

      if (!["http:", "https:"].includes(url.protocol)) {
        continue;
      }

      if (seen.has(url.href)) {
        continue;
      }

      seen.add(url.href);

      candidates.push({
        text: text || "Privacy-related link",
        href: url.href
      });
    } catch {
      continue;
    }
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
