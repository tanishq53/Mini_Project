// PrivacyGuard tracker content script. Owner: Namitha K.
// Detects third-party tracking scripts on the current page and calls
// window.__pgDetectPolicy() (policyDetector.js) for the policy result.
//
// Responds to RUN_SCAN messages and sends SCAN_RESULT to background.js.
// Does NOT read cookies, form values, passwords, or user-entered data.
// Does NOT make backend calls from the content script.
// Wrapped in an IIFE to avoid polluting the global scope.

(() => {
  const trackerDomains = {
    analytics: [
      "google-analytics.com",
      "googletagmanager.com",
      "segment.com",
      "hotjar.com",
      "mixpanel.com",
      "amplitude.com"
    ],

    // Check social before advertising because facebook.net
    // also matches connect.facebook.net.
    social: [
      "connect.facebook.net",
      "platform.twitter.com",
      "platform.linkedin.com",
      "platform.instagram.com"
    ],

    advertising: [
      "doubleclick.net",
      "googlesyndication.com",
      "googleadservices.com",
      "facebook.net",
      "adsrvr.org",
      "adnxs.com"
    ]
  };

  function getCategory(hostname) {
    for (const [category, domains] of Object.entries(trackerDomains)) {
      if (
        domains.some(domain =>
          hostname === domain || hostname.endsWith("." + domain)
        )
      ) {
        return category;
      }
    }

    return "unknown";
  }

  // A site's own domains are not third parties: amazon.com loading media-amazon.com is the same company.
  // Each group lists domains that belong to one organisation. Keep it short and easy to edit.
  const sameCompany = [
    ["google.com", "gstatic.com", "googleusercontent.com", "ggpht.com", "youtube.com", "ytimg.com"],
    ["amazon.com", "amazon.in", "media-amazon.com", "ssl-images-amazon.com", "images-amazon.com", "primevideo.com"],
    ["facebook.com", "fbcdn.net", "instagram.com", "cdninstagram.com"],
    ["microsoft.com", "live.com", "office.com", "msecnd.net", "azureedge.net"],
    ["apple.com", "icloud.com", "mzstatic.com"]
  ];

  // Two-part public suffixes such as co.uk, so "shop.example.co.uk" is treated as site "example.co.uk".
  const twoPartSuffixes = ["co.uk", "org.uk", "co.in", "ac.in", "gov.in", "com.au", "co.jp", "com.br", "co.nz"];

  function siteOf(hostname) {
    const parts = hostname.split(".");
    // localhost and IP addresses have no registrable domain, so use them as they are.
    if (parts.length < 2 || /^\d+(\.\d+){3}$/.test(hostname)) return hostname;
    const lastTwo = parts.slice(-2).join(".");
    return twoPartSuffixes.includes(lastTwo) && parts.length >= 3 ? parts.slice(-3).join(".") : lastTwo;
  }

  function isSameCompany(siteA, siteB) {
    return sameCompany.some(group => group.includes(siteA) && group.includes(siteB));
  }

  function isThirdParty(hostname) {
    const pageSite = siteOf(window.location.hostname);
    const scriptSite = siteOf(hostname);
    return scriptSite !== pageSite && !isSameCompany(scriptSite, pageSite);
  }

  // Zero-filled result — returned on error or when there is nothing to report.
  // Ensures background.js always receives a valid, contract-shaped object.
  function emptyResult() {
    return {
      tracking: {
        thirdPartyScripts: trackerList.length,
        trackers,
        trackerList
      },
      policy: window.__pgDetectPolicy
        ? window.__pgDetectPolicy()
        : {
            found: false,
            url: null,
            candidates: []
          }
    };
  }

  function scanTracking() {
    const trackerList = [];
    // Deduplicate by hostname: multiple <script> elements from the same host
    // should only be counted once.
    const seenHostnames = new Set();

    const scripts = document.querySelectorAll("script[src]");

    for (const script of scripts) {
      try {
        const url = new URL(script.src, window.location.href);
        const hostname = url.hostname.toLowerCase();

        if (!hostname || !isThirdParty(hostname)) {
          continue;
        }

        if (seenHostnames.has(hostname)) {
          continue;
        }

        seenHostnames.add(hostname);

        trackerList.push({
          domain: hostname,
          category: getCategory(hostname)
        });
      } catch {
        continue;
      }
    }

    const trackers = {
      analytics: 0,
      advertising: 0,
      social: 0,
      unknown: 0
    };

    for (const tracker of trackerList) {
      trackers[tracker.category]++;
    }

    return {
      tracking: {
        thirdPartyScripts: trackerList.length,
        trackers,
        trackerList
      },
      policy: window.__pgDetectPolicy
        ? window.__pgDetectPolicy()
        : {
            found: false,
            url: null,
            candidates: []
          }
    };
  }

  // Respond to RUN_SCAN sent by background.js (docs/contract.md §3).
  // Always sends SCAN_RESULT — even on error — so background does not time out.
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "RUN_SCAN") return;

    console.log("PrivacyGuard tracker: received RUN_SCAN");

    let data;
    try {
      data = scanTracking();
    } catch (err) {
      console.error("PrivacyGuard tracker: scan error", err);
      data = emptyResult();
    }

    chrome.runtime.sendMessage({
      type: "SCAN_RESULT",
      payload: {
        source: "tracker",
        data
      }
    });
  });
})();
