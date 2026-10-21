
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
    advertising: [
      "doubleclick.net",
      "googlesyndication.com",
      "googleadservices.com",
      "facebook.net",
      "adsrvr.org",
      "adnxs.com"
    ],
    social: [
      "connect.facebook.net",
      "platform.twitter.com",
      "platform.linkedin.com",
      "platform.instagram.com"
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

  function isThirdParty(hostname) {
    const currentHost = window.location.hostname;

    return hostname !== currentHost &&
      !hostname.endsWith("." + currentHost);
  }

  function scanTracking() {
    const trackerList = [];
    const seenDomains = new Set();

    const scripts = document.querySelectorAll("script[src]");

    for (const script of scripts) {
      try {
        const url = new URL(script.src, window.location.href);
        const hostname = url.hostname.toLowerCase();

        if (!hostname || !isThirdParty(hostname)) {
          continue;
        }

        if (seenDomains.has(hostname)) {
          continue;
        }

        seenDomains.add(hostname);

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

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "RUN_SCAN") {
      console.log("Tracker received RUN_SCAN");

      chrome.runtime.sendMessage({
        type: "SCAN_RESULT",
        payload: {
          source: "tracker",
          data: scanTracking()
        }
      });
    }
  });
})();
