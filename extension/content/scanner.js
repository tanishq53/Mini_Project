// Owner: Varsha. Personal-data field scanner (docs/contract.md §4.1).
// Detection uses read-only attributes only. Never reads .value or any user input.
// Never submits forms, clicks elements, or sends field contents anywhere.
(() => {

  // Input types that carry no personal data and must be skipped.
  const SKIP_TYPES = new Set([
    "submit", "button", "image", "reset",
    "hidden", "checkbox", "radio", "file", "range", "color"
  ]);

  // Keyword tables for each of the eight contract categories.
  // Checked in priority order so a field is classified exactly once.
  const RULES = [
    {
      category: "password",
      // '(?<![a-z])pass(?![a-z])' matches 'pass', 'confirm_pass' but NOT 'passport'.
      keywords: ["password", "passwd", "(?<![a-z])pass(?![a-z])", "confirm.?pass", "new.?pass", "current.?pass"]
    },
    {
      // governmentId is checked BEFORE financial so 'pan_card', 'aadhaar_card'
      // are classified as governmentId rather than financial.
      category: "governmentId",
      // '(?<![a-z])pan(?![a-z])' matches 'pan', 'pan_card', 'aadhaar_pan'
      // but NOT 'panelId', 'company_name', 'expansion'.
      keywords: [
        "aadhaar", "aadhar", "(?<![a-z])pan(?![a-z])", "passport", "ssn",
        "social.?security", "national.?id", "(?<![a-z])nid(?![a-z])",
        "driving.?licen", "driver.?licen", "dl.?num",
        "tax.?id", "taxpayer", "voter.?id", "(?<![a-z])ration(?![a-z])"
      ]
    },
    {
      category: "financial",
      keywords: [
        // '(?<![a-z])card(?![a-z])' avoids false positives on 'discard', 'scorecard'.
        "(?<![a-z])card(?![a-z])", "credit", "debit", "cvv", "cvc", "csc",
        "expir", "ccnum", "cardnum", "card.?number",
        "account.?num", "bank.?account", "routing", "ifsc", "upi"
      ]
    },
    {
      category: "email",
      keywords: ["email", "e.?mail", "emailaddress"]
    },
    {
      category: "phone",
      // '(?<![a-z])tel(?![a-z])' matches 'tel', 'tel_number', 'telephone'
      // but NOT 'hotel', 'motel'.
      keywords: [
        "phone", "mobile", "telephone", "(?<![a-z])tel(?![a-z])", "(?<![a-z])cell(?![a-z])",
        "contact.?num", "phone.?num", "phone.?no", "phoneno",
        "mob.?num", "mob.?no", "whatsapp"
      ]
    },
    {
      category: "dob",
      // '(?<![a-z])born(?![a-z])' avoids false positives on 'airborne', 'newborn'.
      keywords: [
        "dob", "date.?of.?birth", "birth.?date", "birthday",
        "birth.?day", "bday", "(?<![a-z])born(?![a-z])"
      ]
    },
    {
      category: "address",
      // Bare 'state' matched 'statement'; 'city' matched 'electricity'/'publicity';
      // 'zip' matched 'unzip'. All three now use word-boundary lookbehind+lookahead.
      keywords: [
        "address", "addr", "street", "(?<![a-z])city(?![a-z])", "(?<![a-z])state(?![a-z])",
        "country", "(?<![a-z])zip(?![a-z])", "postal", "pincode", "pin.?code",
        "landmark", "locality", "district", "region"
      ]
    },
    {
      category: "name",
      // '(?<![a-z_])name(?![a-z])' matches standalone 'name' / 'Name' / 'Enter your name'
      // but NOT '_name' suffixes such as company_name, product_name, domain_name, hotel_name.
      // All compound personal-name forms (first_name, last_name, …) are caught by their
      // own explicit keywords below, so the bare 'name' entry only needs to cover the
      // case where the attribute or label is literally "name" / "Name".
      keywords: [
        "(?<![a-z_])name(?![a-z])", "fullname", "full.?name",
        "firstname", "first.?name", "fname",
        "lastname", "last.?name", "lname",
        "middlename", "middle.?name",
        "username", "user.?name", "display.?name"
      ]
    }
  ];

  /**
   * Collect all safe text signals from an element's read-only attributes.
   * Returns a single lowercase string for keyword matching.
   * Never touches .value or any property that reveals what the user typed.
   */
  function getSignals(el) {
    const parts = [
      el.getAttribute("type") || "",
      el.getAttribute("name") || "",
      el.getAttribute("id") || "",
      el.getAttribute("placeholder") || "",
      el.getAttribute("autocomplete") || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("aria-labelledby") ? getLabelledByText(el) : "",
      getLabelText(el)
    ];
    return parts.join(" ").toLowerCase();
  }

  /**
   * Find the text of a <label> associated with el via the `for` attribute
   * or by direct DOM ancestry. Never reads user-typed text.
   */
  function getLabelText(el) {
    // 1. label[for=id]
    if (el.id) {
      const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lbl) return lbl.textContent || "";
    }
    // 2. Ancestor <label>
    let node = el.parentElement;
    while (node && node.tagName !== "FORM" && node !== document.body) {
      if (node.tagName === "LABEL") return node.textContent || "";
      node = node.parentElement;
    }
    return "";
  }

  /**
   * Resolve aria-labelledby to visible text (safe: reads static DOM text, not values).
   */
  function getLabelledByText(el) {
    const ids = (el.getAttribute("aria-labelledby") || "").trim().split(/\s+/);
    return ids.map(id => {
      const ref = document.getElementById(id);
      return ref ? (ref.textContent || "") : "";
    }).join(" ");
  }

  /**
   * Classify an element into one of the eight contract categories.
   * Returns the category string or null if not a personal-data field.
   */
  function classify(el) {
    const signals = getSignals(el);

    // Fields whose HTML type attribute is "email" or "tel" are strong hints.
    const htmlType = (el.getAttribute("type") || "").toLowerCase();
    if (htmlType === "email") return "email";
    if (htmlType === "tel") return "phone";
    if (htmlType === "password") return "password";

    for (const rule of RULES) {
      for (const kw of rule.keywords) {
        if (new RegExp(kw, "i").test(signals)) {
          return rule.category;
        }
      }
    }
    return null;
  }

  /**
   * Determine the index of the closest ancestor <form>, or -1 for standalone fields.
   */
  function formIndex(el, forms) {
    let node = el.parentElement;
    while (node) {
      const idx = Array.prototype.indexOf.call(forms, node);
      if (idx !== -1) return idx;
      node = node.parentElement;
    }
    return -1;
  }

  /**
   * Main scan function. Inspects the live DOM and returns the §4.1 object.
   * Wrapped in try/catch so unexpected DOM errors never break the message contract.
   */
  function scanPage() {
    const result = {
      forms: 0,
      personalDataFields: 0,
      fieldTypes: {
        name: 0, email: 0, phone: 0, address: 0,
        dob: 0, password: 0, financial: 0, governmentId: 0
      },
      fields: []
    };

    try {
      const forms = document.querySelectorAll("form");
      result.forms = forms.length;

      const candidates = document.querySelectorAll("input, select, textarea");

      candidates.forEach((el) => {
        const rawType = (el.getAttribute("type") || "text").toLowerCase();

        // Skip non-personal-data input types (requirement 8).
        if (SKIP_TYPES.has(rawType)) return;

        const category = classify(el);
        if (!category) return;   // Not a personal-data field.

        // Count.
        result.fieldTypes[category] += 1;

        // Safe metadata only — never .value.
        result.fields.push({
          category,
          name: el.getAttribute("name") || el.getAttribute("id") || "",
          type: rawType,
          formIndex: formIndex(el, forms)
        });
      });

      // personalDataFields MUST equal the exact sum of all fieldTypes values.
      result.personalDataFields = Object.values(result.fieldTypes)
        .reduce((sum, n) => sum + n, 0);

    } catch (err) {
      // DOM error: return the zeroed result with a warning in the fields array.
      // The shape remains valid so background.js can still merge the response.
      console.warn("PrivacyGuard scanner error:", err);
    }

    return result;
  }

  // ── Message handler ─────────────────────────────────────────────────────────
  // Contract §3: listen for RUN_SCAN, reply with SCAN_RESULT.
  // Shape: { type, payload: { source, data } }  (unchanged from the stub).
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "RUN_SCAN") {
      chrome.runtime.sendMessage({
        type: "SCAN_RESULT",
        payload: { source: "scanner", data: scanPage() }
      });
    }
  });

})();
