// Owner: Tanishq. Notify the background when an SPA route or meaningful page content changes.
(() => {
  let timer = null;
  let lastContent = "";
  let stopped = false;
  let observer = null;

  const stopWatcher = () => {
    stopped = true;
    clearTimeout(timer);
    observer?.disconnect();
  };

  const isInvalidated = (error) =>
    /extension context invalidated/i.test(error?.message || String(error));

  const contentSignature = () => {
    const fields = [...document.querySelectorAll("input,select,textarea")]
      .map((el) => [el.tagName, el.getAttribute("type"), el.getAttribute("name"), el.id].join(":"));
    const scripts = [...document.querySelectorAll("script[src]")].map((el) => el.src);
    return `${fields.join("|")}#${scripts.join("|")}`;
  };

  const report = (reason) => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      lastContent = contentSignature();
      try {
        chrome.runtime.sendMessage({
          type: "PAGE_CHANGED",
          payload: { url: location.href, reason }
        }).catch((error) => {
          if (isInvalidated(error)) stopWatcher();
        });
      } catch (error) {
        // Reloading the extension invalidates content scripts already injected in open tabs.
        if (isInvalidated(error)) stopWatcher();
      }
    }, 500);
  };

  lastContent = contentSignature();
  observer = new MutationObserver(() => {
    const signature = contentSignature();
    if (signature !== lastContent) report("content");
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["src", "name", "type", "id"] });
})();
