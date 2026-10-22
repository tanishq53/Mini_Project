// Owner: Namitha. Phase 1 third-party script classification (docs/contract.md).
// Scripts are counted by unique hostname. Cookies are read by the background service worker.
(() => {
  const categories = {
    social: ["connect.facebook.net", "platform.twitter.com", "platform.linkedin.com", "platform.instagram.com"],
    advertising: ["doubleclick.net", "googlesyndication.com", "googleadservices.com", "facebook.net", "adsrvr.org", "adnxs.com"],
    analytics: ["google-analytics.com", "googletagmanager.com", "segment.com", "hotjar.com", "mixpanel.com", "amplitude.com"]
  };

  // Domains that one company commonly uses across its own products and asset hosts.
  const sameCompany = [
    ["google.com", "google.co.uk", "google.co.in", "gstatic.com", "googleusercontent.com", "ggpht.com", "youtube.com", "ytimg.com"],
    ["amazon.com", "amazon.in", "amazon.co.uk", "media-amazon.com", "ssl-images-amazon.com", "images-amazon.com", "primevideo.com"],
    ["facebook.com", "fbcdn.net", "instagram.com", "cdninstagram.com"],
    ["microsoft.com", "live.com", "office.com", "msecnd.net", "azureedge.net"],
    ["apple.com", "icloud.com", "mzstatic.com"]
  ];
  const twoPartSuffixes = new Set([
    "co.uk", "org.uk", "ac.uk", "gov.uk", "com.uk", "co.in", "org.in", "ac.in", "gov.in", "net.in",
    "com.au", "net.au", "org.au", "co.jp", "co.nz", "com.br", "com.sg", "com.mx", "co.za"
  ]);
  const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const IPV6 = /^\[?[\da-f:]+\]?$/i;

  function siteOf(hostname) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (host === "localhost" || IPV4.test(host) || IPV6.test(host)) return host;
    const labels = host.split(".").filter(Boolean);
    if (labels.length < 2) return host;
    const suffix = labels.slice(-2).join(".");
    return twoPartSuffixes.has(suffix) && labels.length >= 3 ? labels.slice(-3).join(".") : suffix;
  }

  function sameOrganisation(siteA, siteB) {
    return sameCompany.some((group) => group.includes(siteA) && group.includes(siteB));
  }

  function isThirdParty(hostname) {
    const pageSite = siteOf(location.hostname);
    const scriptSite = siteOf(hostname);
    return scriptSite !== pageSite && !sameOrganisation(pageSite, scriptSite);
  }

  function categoryFor(hostname) {
    // Specific social hosts are tested before the broader facebook.net advertising domain.
    for (const category of ["social", "advertising", "analytics"]) {
      if (categories[category].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return category;
    }
    return "unknown";
  }

  function emptyResult() {
    return {
      tracking: { thirdPartyScripts: 0, trackers: { analytics: 0, advertising: 0, social: 0, unknown: 0 }, trackerList: [] },
      // Phase 1 keeps the contract field zero-filled; policy analysis is not run here.
      policy: { found: false, url: null, candidates: [] }
    };
  }

  function scanTracking() {
    const trackerList = [];
    const seen = new Set();
    for (const script of document.querySelectorAll("script[src]")) {
      try {
        const url = new URL(script.getAttribute("src"), location.href);
        const hostname = url.hostname.toLowerCase();
        if (!hostname || !["http:", "https:"].includes(url.protocol) || !isThirdParty(hostname) || seen.has(hostname)) continue;
        seen.add(hostname);
        trackerList.push({ domain: hostname, category: categoryFor(hostname) });
      } catch {
        // Ignore malformed script URLs; they cannot be classified reliably.
      }
    }

    const trackers = { analytics: 0, advertising: 0, social: 0, unknown: 0 };
    for (const tracker of trackerList) trackers[tracker.category] += 1;
    return {
      tracking: { thirdPartyScripts: trackerList.length, trackers, trackerList },
      policy: { found: false, url: null, candidates: [] }
    };
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "RUN_SCAN") return;
    let data;
    try {
      data = scanTracking();
    } catch (error) {
      console.warn("PrivacyGuard tracker error:", error);
      data = emptyResult();
    }
    chrome.runtime.sendMessage({ type: "SCAN_RESULT", payload: { source: "tracker", data } }).catch(() => {});
  });
})();
