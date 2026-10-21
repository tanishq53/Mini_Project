
window.__pgDetectPolicy = function () {
  const candidates = [];
  const seen = new Set();

  const links = document.querySelectorAll("a[href]");

  for (const link of links) {
    const text = (
      link.innerText ||
      link.getAttribute("aria-label") ||
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

  // Prefer an exact privacy-policy link label.
  const bestMatch =
    candidates.find(candidate =>
      /^(privacy policy|privacy notice|privacy statement)$/i.test(
        candidate.text.trim()
      )
    ) ||
    candidates.find(candidate =>
      /privacy policy|privacy notice|privacy statement/i.test(
        candidate.text + " " + candidate.href
      )
    );

  return {
    found: Boolean(bestMatch),
    url: bestMatch ? bestMatch.href : null,
    candidates
  };
};
