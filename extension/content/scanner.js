// Owner: Varsha. Read-only personal-data field detection for docs/contract.md.
// Only static attributes and associated labels are inspected; element.value is never read.
(() => {
  const FIELD_TYPES = ["name", "email", "phone", "address", "dob", "password", "financial", "governmentId"];
  const SKIP_TYPES = new Set(["hidden", "submit", "button", "image", "reset", "checkbox", "radio", "file", "range", "color"]);

  const PATTERNS = [
    ["password", /(?:^|\b)(?:password|passwd|passcode|pass)(?:\b|$)|(?:confirm|new|current)[\s_-]*pass(?:word)?/],
    ["governmentId", /(?:^|\b)(?:aadhaar|aadhar|passport|ssn|nid|voter[\s_-]*id|national[\s_-]*id|tax[\s_-]*(?:id|payer)|driving[\s_-]*licen[sc]e|driver[\s_-]*licen[sc]e|ration[\s_-]*card)(?:\b|$)|\bpan\b/],
    ["financial", /(?:^|\b)(?:credit|debit|card[\s_-]*(?:number|no)|cardnumber|cc[\s_-]*number|ccnum|cvv|cvc|csc|expiry|expiration|bank[\s_-]*account|account[\s_-]*number|routing|ifsc|upi)(?:\b|$)/],
    ["email", /(?:^|\b)(?:e[\s_-]*mail|email[\s_-]*address|emailaddress)(?:\b|$)/],
    ["phone", /(?:^|\b)(?:phone|mobile|telephone|tel|cell|whatsapp)(?:\b|$)|(?:contact|phone|mobile)[\s_-]*(?:number|no)/],
    ["dob", /(?:^|\b)(?:dob|birthday|birth[\s_-]*date|date[\s_-]*of[\s_-]*birth|bday)(?:\b|$)/],
    ["address", /(?:^|\b)(?:address|street|city|state|country|zip|postal|pincode|pin[\s_-]*code|landmark|locality|district|region)(?:\b|$)/],
    ["name", /(?:^|\b)(?:full[\s_-]*name|first[\s_-]*name|last[\s_-]*name|middle[\s_-]*name|given[\s_-]*name|family[\s_-]*name|fname|lname|username|user[\s_-]*name|display[\s_-]*name|name)(?:\b|$)/]
  ];

  function labelText(el) {
    const labels = [];
    if (el.labels) {
      for (const label of el.labels) labels.push(label.textContent || "");
    }
    const labelId = el.getAttribute("aria-labelledby");
    if (labelId) {
      for (const id of labelId.trim().split(/\s+/)) {
        const label = document.getElementById(id);
        if (label) labels.push(label.textContent || "");
      }
    }
    return labels.join(" ");
  }

  function classify(el) {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "email") return "email";
    if (type === "tel") return "phone";
    if (type === "password") return "password";

    const signals = ["name", "id", "placeholder", "autocomplete", "aria-label"]
      .map((attr) => el.getAttribute(attr) || "")
      .concat(labelText(el))
      .join(" ")
      // Split camelCase while preserving underscores and punctuation for regex boundaries.
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_.-]+/g, " ")
      .toLowerCase();

    // A company or organization name is not a person's name.
    if (/\b(?:company|organization|organisation|business|employer|employee)\b/.test(signals) && /\bname\b/.test(signals)) {
      const personalNameHint = /\b(?:first|last|middle|full|user|display)[\s_-]*name\b/.test(signals);
      if (!personalNameHint) {
        const withoutCompanyName = signals.replace(/\b(?:company|organization|organisation|business|employer|employee)[\s_-]*name\b/g, "");
        for (const [category, pattern] of PATTERNS) {
          if (category !== "name" && pattern.test(withoutCompanyName)) return category;
        }
        return null;
      }
    }
    for (const [category, pattern] of PATTERNS) if (pattern.test(signals)) return category;
    return null;
  }

  function scanPage() {
    const result = {
      forms: document.querySelectorAll("form").length,
      personalDataFields: 0,
      fieldTypes: Object.fromEntries(FIELD_TYPES.map((key) => [key, 0])),
      fields: []
    };
    const forms = [...document.querySelectorAll("form")];
    for (const el of document.querySelectorAll("input, select, textarea")) {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (SKIP_TYPES.has(type)) continue;
      const category = classify(el);
      if (!category) continue;
      result.fieldTypes[category] += 1;
      const form = el.closest("form");
      result.fields.push({
        category,
        name: el.getAttribute("name") || el.getAttribute("id") || "",
        type,
        formIndex: form ? forms.indexOf(form) : -1
      });
    }
    result.personalDataFields = FIELD_TYPES.reduce((total, key) => total + result.fieldTypes[key], 0);
    return result;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "RUN_SCAN") return;
    let data;
    try {
      data = scanPage();
    } catch (error) {
      console.warn("PrivacyGuard scanner error:", error);
      data = { forms: 0, personalDataFields: 0, fieldTypes: Object.fromEntries(FIELD_TYPES.map((key) => [key, 0])), fields: [] };
    }
    chrome.runtime.sendMessage({ type: "SCAN_RESULT", payload: { source: "scanner", data } }).catch(() => {});
  });
})();
