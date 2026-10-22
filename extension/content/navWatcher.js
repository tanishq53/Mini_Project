// Owner: Tanishq. Notify the background when an SPA route or meaningful page content changes.
(() => {
  let timer = null;
  let lastContent = "";

  const contentSignature = () => {
    const fields = [...document.querySelectorAll("input,select,textarea")]
      .map((el) => [el.tagName, el.getAttribute("type"), el.getAttribute("name"), el.id].join(":"));
    const scripts = [...document.querySelectorAll("script[src]")].map((el) => el.src);
    return `${fields.join("|")}#${scripts.join("|")}`;
  };

  const report = (reason) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      lastContent = contentSignature();
      chrome.runtime.sendMessage({ type: "PAGE_CHANGED", payload: { url: location.href, reason } }).catch(() => {});
    }, 500);
  };

  lastContent = contentSignature();
  const observer = new MutationObserver(() => {
    const signature = contentSignature();
    if (signature !== lastContent) report("content");
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["src", "name", "type", "id"] });
})();
