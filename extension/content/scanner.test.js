/**
 * scanner.test.js  --  Owner: Varsha
 * Node.js harness for scanner.js. No third-party packages.
 * Run: node extension/content/scanner.test.js
 * Exit 0 = pass, 1 = fail.
 *
 * RULES must stay in sync with scanner.js manually.
 */
"use strict";

// ── 1. Fake DOM builders ──────────────────────────────────────
function makeInput(o) {
  o = o || {};
  var attrs = {
    type: o.type || "text", name: o.name || "", id: o.id || "",
    placeholder: o.placeholder || "", autocomplete: o.autocomplete || "",
    "aria-label": o.ariaLabel || "",
    "aria-labelledby": o.ariaLbText ? "__stub__" : ""
  };
  return {
    getAttribute: function(a) {
      return Object.prototype.hasOwnProperty.call(attrs, a) ? attrs[a] : null;
    },
    id: o.id || "",
    _parent: null,
    _labelText: o.labelText || "",
    _ariaLbText: o.ariaLbText || "",
    tagName: "INPUT"
  };
}
function makeForm() { return { tagName: "FORM", parentElement: null }; }
function attachToForm(el, form) {
  var w = { tagName: "DIV", parentElement: form, _labelText: "" };
  form.parentElement = null;
  el._parent = w;
}

// ── 2. Logic mirrored from scanner.js  (keep in sync) ────────
var SKIP_TYPES = new Set([
  "submit","button","image","reset","hidden",
  "checkbox","radio","file","range","color"
]);
var RULES = [
  { category: "password",
    keywords: ["password","passwd","(?<![a-z])pass(?![a-z])","confirm.?pass","new.?pass","current.?pass"] },
  { category: "governmentId",
    keywords: ["aadhaar","aadhar","(?<![a-z])pan(?![a-z])","passport","ssn",
      "social.?security","national.?id","(?<![a-z])nid(?![a-z])",
      "driving.?licen","driver.?licen","dl.?num",
      "tax.?id","taxpayer","voter.?id","(?<![a-z])ration(?![a-z])"] },
  { category: "financial",
    keywords: ["(?<![a-z])card(?![a-z])","credit","debit","cvv","cvc","csc",
      "expir","ccnum","cardnum","card.?number",
      "account.?num","bank.?account","routing","ifsc","upi"] },
  { category: "email",
    keywords: ["email","e.?mail","emailaddress"] },
  { category: "phone",
    keywords: ["phone","mobile","telephone","(?<![a-z])tel(?![a-z])","(?<![a-z])cell(?![a-z])",
      "contact.?num","phone.?num","phone.?no","phoneno","mob.?num","mob.?no","whatsapp"] },
  { category: "dob",
    keywords: ["dob","date.?of.?birth","birth.?date","birthday",
      "birth.?day","bday","(?<![a-z])born(?![a-z])"] },
  { category: "address",
    keywords: ["address","addr","street","(?<![a-z])city(?![a-z])","(?<![a-z])state(?![a-z])",
      "country","(?<![a-z])zip(?![a-z])","postal","pincode","pin.?code",
      "landmark","locality","district","region"] },
  { category: "name",
    keywords: ["(?<![a-z_])name(?![a-z])","fullname","full.?name",
      "firstname","first.?name","fname","lastname","last.?name","lname",
      "middlename","middle.?name","username","user.?name","display.?name"] }
];

function getLabelledByText(el) { return el._ariaLbText || ""; }
function getLabelText(el) {
  if (el._labelText) return el._labelText;
  var n = el._parent;
  while (n && n.tagName !== "FORM" && n.tagName !== "BODY") {
    if (n.tagName === "LABEL") return n._labelText || "";
    n = n.parentElement;
  }
  return "";
}
function getSignals(el) {
  return [
    el.getAttribute("type")        || "",
    el.getAttribute("name")        || "",
    el.getAttribute("id")          || "",
    el.getAttribute("placeholder") || "",
    el.getAttribute("autocomplete")|| "",
    el.getAttribute("aria-label")  || "",
    el.getAttribute("aria-labelledby") ? getLabelledByText(el) : "",
    getLabelText(el)
  ].join(" ").toLowerCase();
}
function classify(el) {
  var ht = (el.getAttribute("type") || "").toLowerCase();
  if (ht === "email")    return "email";
  if (ht === "tel")      return "phone";
  if (ht === "password") return "password";
  var s = getSignals(el);
  for (var i = 0; i < RULES.length; i++)
    for (var j = 0; j < RULES[i].keywords.length; j++)
      if (new RegExp(RULES[i].keywords[j], "i").test(s)) return RULES[i].category;
  return null;
}
function formIndex(el, forms) {
  var n = el._parent;
  while (n) {
    var idx = Array.prototype.indexOf.call(forms, n);
    if (idx !== -1) return idx;
    n = n.parentElement;
  }
  return -1;
}
function scanPage(forms, inputs) {
  var r = {
    forms: forms.length, personalDataFields: 0,
    fieldTypes: { name:0,email:0,phone:0,address:0,dob:0,password:0,financial:0,governmentId:0 },
    fields: []
  };
  inputs.forEach(function(el) {
    var rt = (el.getAttribute("type") || "text").toLowerCase();
    if (SKIP_TYPES.has(rt)) return;
    var cat = classify(el);
    if (!cat) return;
    r.fieldTypes[cat]++;
    r.fields.push({ category: cat,
      name: el.getAttribute("name") || el.getAttribute("id") || "",
      type: rt, formIndex: formIndex(el, forms) });
  });
  r.personalDataFields = Object.values(r.fieldTypes).reduce(function(a,b){return a+b;}, 0);
  return r;
}

// ── 3. Test runner ────────────────────────────────────────────
var passed = 0, failed = 0, failures = [];
function assert(lbl, got, want) {
  if (got === want) { passed++; return; }
  failed++;
  var m = "FAIL  " + lbl + "\n      want=" + JSON.stringify(want) + "  got=" + JSON.stringify(got);
  failures.push(m); console.log(m);
}
function assertSum(lbl, r) {
  var s = Object.values(r.fieldTypes).reduce(function(a,b){return a+b;}, 0);
  assert(lbl + " [pdf==sum(ft)]", r.personalDataFields, s);
}
function assertNoDups(lbl, r) {
  assert(lbl + " [fields.len==pdf]", r.fields.length, r.personalDataFields);
}
function sec(t) {
  console.log("\n" + "=".repeat(64) + "\n" + t + "\n" + "=".repeat(64));
}
function cls(nm) { return classify(makeInput({name: nm, id: nm})); }

// ── 4. T1 — login-with-policy (simulated DOM) ─────────────────
// test-pages/login-with-policy.html = Phase-3 placeholder (Tanishq). NOT RUN vs real file.
sec("T1 login-with-policy  [RUN — simulated DOM]");
var f1 = makeForm();
var t1 = [
  makeInput({type:"text",    name:"full_name", id:"full_name"}),
  makeInput({type:"email",   name:"email",     id:"email"}),
  makeInput({type:"tel",     name:"phone",     id:"phone"}),
  makeInput({type:"text",    name:"address",   id:"address"}),
  makeInput({type:"password",name:"password",  id:"password"})
];
t1.forEach(function(el){ attachToForm(el, f1); });
var r1 = scanPage([f1], t1);
assert("T1 forms",   r1.forms,               1);
assert("T1 pdf",     r1.personalDataFields,   5);
assert("T1 name",    r1.fieldTypes.name,      1);
assert("T1 email",   r1.fieldTypes.email,     1);
assert("T1 phone",   r1.fieldTypes.phone,     1);
assert("T1 address", r1.fieldTypes.address,   1);
assert("T1 password",r1.fieldTypes.password,  1);
assert("T1 dob",     r1.fieldTypes.dob,       0);
assert("T1 fin",     r1.fieldTypes.financial, 0);
assert("T1 govId",   r1.fieldTypes.governmentId, 0);
assertSum("T1", r1); assertNoDups("T1", r1);

// ── 5. T2 — many-forms (simulated DOM) ───────────────────────
// test-pages/many-forms.html = Phase-3 placeholder (Tanishq). NOT RUN vs real file.
sec("T2 many-forms  [RUN — simulated DOM]");
var f2a = makeForm(), f2b = makeForm(), f2c = makeForm();
var t2 = [
  makeInput({type:"text",    name:"first_name",    id:"first_name"}),
  makeInput({type:"email",   name:"email",          id:"email"}),
  makeInput({type:"tel",     name:"mobile",         id:"mobile"}),
  makeInput({type:"text",    name:"dob",            id:"dob"}),
  makeInput({type:"password",name:"password",       id:"password"}),
  makeInput({type:"email",   name:"receipt_email",  id:"receipt_email"}),
  makeInput({type:"text",    name:"card_number",    id:"card_number"}),
  makeInput({type:"text",    name:"cvv",            id:"cvv"}),
  makeInput({type:"text",    name:"aadhaar_number", id:"aadhaar_number"})
];
t2.slice(0,5).forEach(function(el){ attachToForm(el, f2a); });
t2.slice(5,8).forEach(function(el){ attachToForm(el, f2b); });
t2.slice(8,9).forEach(function(el){ attachToForm(el, f2c); });
var r2 = scanPage([f2a,f2b,f2c], t2);
assert("T2 forms",    r2.forms,                    3);
assert("T2 pdf",      r2.personalDataFields,        9);
assert("T2 name",     r2.fieldTypes.name,           1);
assert("T2 email",    r2.fieldTypes.email,          2);
assert("T2 phone",    r2.fieldTypes.phone,          1);
assert("T2 dob",      r2.fieldTypes.dob,            1);
assert("T2 password", r2.fieldTypes.password,       1);
assert("T2 fin",      r2.fieldTypes.financial,      2);
assert("T2 govId",    r2.fieldTypes.governmentId,   1);
assert("T2 address",  r2.fieldTypes.address,        0);
assertSum("T2", r2); assertNoDups("T2", r2);

// ── EC1 — explicit label[for=id] ─────────────────────────────
// scanner.js getLabelText(): label[for=id] via CSS.escape+querySelector.
// Harness: _labelText on element stubs that DOM lookup.
sec("EC1  label[for=id]  [RUN]");
assert("EC1a label 'Email address' -> email",
  classify(makeInput({labelText:"Email address"})), "email");
assert("EC1b label 'First Name' -> name",
  classify(makeInput({labelText:"First Name"})), "name");
assert("EC1c label 'Date of Birth' -> dob",
  classify(makeInput({labelText:"Date of Birth"})), "dob");
assert("EC1d label 'Postal Code' -> address",
  classify(makeInput({labelText:"Postal Code"})), "address");
assert("EC1e label 'Card Number' -> financial",
  classify(makeInput({labelText:"Card Number"})), "financial");
assert("EC1f label 'Passport Number' -> governmentId",
  classify(makeInput({labelText:"Passport Number"})), "governmentId");
assert("EC1g label 'Aadhaar' -> governmentId",
  classify(makeInput({labelText:"Aadhaar"})), "governmentId");
// Unrelated label + no personal attributes -> null
assert("EC1h label 'Company Information', name='org_info' -> null",
  classify(makeInput({name:"org_info",id:"org_info",labelText:"Company Information"})), null);

// ── EC2 — input nested inside <label> ────────────────────────
// scanner.js getLabelText(): walks parentElement chain for LABEL.
// Harness: input._parent = LABEL node with _labelText.
sec("EC2  input nested inside <label>  [RUN]");
function inLabel(txt, o) {
  var el = makeInput(o || {});
  el._parent = { tagName: "LABEL", _labelText: txt, parentElement: null };
  return el;
}
assert("EC2a ancestor label 'Mobile Number' -> phone",
  classify(inLabel("Mobile Number")), "phone");
assert("EC2b ancestor label 'Password' -> password (keyword match)",
  classify(inLabel("Password")), "password");
assert("EC2c ancestor label 'Aadhaar Number' -> governmentId",
  classify(inLabel("Aadhaar Number")), "governmentId");
assert("EC2d type=password overrides label content",
  classify(inLabel("Enter secret code", {type:"password"})), "password");
assert("EC2e type=email overrides label content",
  classify(inLabel("Your details here", {type:"email"})), "email");
assert("EC2f ancestor label 'Full Name' -> name",
  classify(inLabel("Full Name")), "name");

// ── EC3 — aria-label / aria-labelledby ───────────────────────
// aria-label: read directly by getSignals().
// aria-labelledby: resolved by getLabelledByText() using _ariaLbText stub.
sec("EC3  aria-label / aria-labelledby  [RUN]");
assert("EC3a aria-label 'Phone number' -> phone",
  classify(makeInput({ariaLabel:"Phone number"})), "phone");
assert("EC3b aria-label 'Email address' -> email",
  classify(makeInput({ariaLabel:"Email address"})), "email");
assert("EC3c aria-label 'Your full name' -> name",
  classify(makeInput({ariaLabel:"Your full name"})), "name");
assert("EC3d aria-labelledby -> 'Date of Birth' -> dob",
  classify(makeInput({ariaLbText:"Date of Birth"})), "dob");
assert("EC3e aria-labelledby -> 'Credit Card Number' -> financial",
  classify(makeInput({ariaLbText:"Credit Card Number"})), "financial");
assert("EC3f aria-labelledby -> 'Passport Number' -> governmentId",
  classify(makeInput({ariaLbText:"Passport Number"})), "governmentId");
assert("EC3g aria-labelledby -> 'Full Name' -> name",
  classify(makeInput({ariaLbText:"Full Name"})), "name");

// ── EC4 — attribute-only, no label ───────────────────────────
sec("EC4  attribute-only, no label  [RUN]");
assert("EC4a placeholder 'Enter your email' -> email",
  classify(makeInput({placeholder:"Enter your email"})), "email");
assert("EC4b autocomplete=email -> email",
  classify(makeInput({autocomplete:"email"})), "email");
assert("EC4c autocomplete=tel -> phone",
  classify(makeInput({autocomplete:"tel"})), "phone");
assert("EC4d placeholder 'Card Number' -> financial",
  classify(makeInput({placeholder:"Card Number"})), "financial");
assert("EC4e name=street_address -> address",
  classify(makeInput({name:"street_address",id:"street_address"})), "address");
assert("EC4f name=dob id=dob -> dob",
  classify(makeInput({name:"dob",id:"dob"})), "dob");
assert("EC4g placeholder 'Zip code' -> address",
  classify(makeInput({placeholder:"Zip code"})), "address");
assert("EC4h type=text no signal -> null",
  classify(makeInput({type:"text"})), null);

// ── EC5 — dynamic fields  [DESIGN VERIFIED] ──────────────────
sec("EC5  dynamic fields  [DESIGN VERIFIED — browser test NOT RUN]");
console.log("  scanPage() is called fresh on every RUN_SCAN message.");
console.log("  document.querySelectorAll runs on live DOM at call time.");
console.log("  Fields added after page load are captured on the next RUN_SCAN.");
console.log("  No MutationObserver in scanner.js — correct by design.");

// ── EC6 — form= attribute / outside ancestor form ─────────────
// formIndex() walks parentElement ancestry only.
// A field using HTML form= attribute but physically outside the <form>
// gets formIndex=-1. Classification and personalDataFields count are correct.
// Known limitation: formIndex is detail-only per contract §4.1.
sec("EC6  form= attribute / outside ancestor form  [RUN]");
var ec6f = makeForm();
var ec6el = makeInput({type:"email", name:"email", id:"email_ec6"});
ec6el._parent = null;   // no ancestor form
var rEC6 = scanPage([ec6f], [ec6el]);
assert("EC6a field classified correctly (no ancestor form)", rEC6.fieldTypes.email, 1);
assert("EC6b counted in personalDataFields",                  rEC6.personalDataFields, 1);
assert("EC6c formIndex == -1",                                rEC6.fields[0].formIndex, -1);
assert("EC6d forms count from forms array",                   rEC6.forms, 1);
console.log("  NOTE: HTML form= attribute not honoured by formIndex().");
console.log("  Affects formIndex metadata only. Count is correct.");

// ── EC7 — duplicate-looking fields ───────────────────────────
// Two distinct elements, same attributes -> counted twice (two real inputs).
// One element cannot appear twice in querySelectorAll results.
sec("EC7  duplicate-looking fields  [RUN]");
var ec7f = makeForm();
var ec7a = makeInput({type:"email", name:"email", id:"ea"});
var ec7b = makeInput({type:"email", name:"email", id:"eb"});
attachToForm(ec7a, ec7f); attachToForm(ec7b, ec7f);
var rEC7 = scanPage([ec7f], [ec7a, ec7b]);
assert("EC7a two distinct email inputs -> email count 2",  rEC7.fieldTypes.email, 2);
assert("EC7b personalDataFields == 2",                     rEC7.personalDataFields, 2);
assert("EC7c fields.length == 2",                          rEC7.fields.length, 2);
assertSum("EC7d", rEC7);
// Single element -> count 1
var ec7s = makeInput({type:"email", name:"email", id:"only"});
ec7s._parent = null;
assert("EC7e single element -> count 1", scanPage([], [ec7s]).fieldTypes.email, 1);

// ── EC8 — SKIP_TYPES ─────────────────────────────────────────
sec("EC8  SKIP_TYPES  [RUN]");
["submit","button","image","reset","hidden","checkbox","radio","file","range","color"]
  .forEach(function(t) {
    var f = makeForm(), el = makeInput({type:t, name:"email"});
    attachToForm(el, f);
    assert("EC8 type=" + t + " skipped even with name=email",
      scanPage([f],[el]).personalDataFields, 0);
  });
// type=number is NOT in SKIP_TYPES
var ec8nf=makeForm(), ec8n=makeInput({type:"number",name:"cvv",id:"cvv"});
attachToForm(ec8n,ec8nf);
assert("EC8 type=number NOT skipped -> financial",
  scanPage([ec8nf],[ec8n]).fieldTypes.financial, 1);
// type=date is NOT in SKIP_TYPES
var ec8df=makeForm(), ec8d=makeInput({type:"date",name:"dob",id:"dob8"});
attachToForm(ec8d,ec8df);
assert("EC8 type=date NOT skipped -> dob",
  scanPage([ec8df],[ec8d]).fieldTypes.dob, 1);

// ── EC9 — misleading substrings ───────────────────────────────
sec("EC9  misleading substrings  [RUN]");
[
  ["company_name", null], ["product_name", null], ["domain_name", null],
  ["hotel",        null], ["motel",        null], ["panelId",     null],
  ["statement",    null], ["unzip",        null], ["discard",     null],
  ["rationalise",  null], ["airborne",     null], ["newborn",     null],
  ["electricity",  null], ["publicity",    null], ["scorecard",   null],
  ["estate",       null]
].forEach(function(p){ assert("EC9 " + p[0] + " -> null", cls(p[0]), null); });

// ── EC10 — password/passport, PAN/panelId, phone/hotel ───────
sec("EC10 password/passport, PAN/panelId, phone/hotel  [RUN]");
[
  ["password",         "password"],    ["confirm_password",  "password"],
  ["new_password",     "password"],    ["current_password",  "password"],
  ["passport",         "governmentId"],["passport_number",   "governmentId"],
  ["pan_card",         "governmentId"],["pan_number",        "governmentId"],
  ["panelId",          null],          ["expansion",         null],
  ["telephone",        "phone"],       ["tel",               "phone"],
  ["cell",             "phone"],
  ["hotel",            null],          ["motel",             null],
  ["ration_card",      "governmentId"],["rationalise",       null],
  ["discard",          null],          ["scorecard",         null]
].forEach(function(p){ assert("EC10 " + p[0], cls(p[0]), p[1]); });

// ── EC11 — standalone inputs outside any form ─────────────────
sec("EC11 standalone inputs outside <form>  [RUN]");
var ec11 = makeInput({type:"email", name:"newsletter", id:"newsletter"});
ec11._parent = null;
var rEC11 = scanPage([], [ec11]);
assert("EC11a email classified correctly",  rEC11.fieldTypes.email,      1);
assert("EC11b counted in personalDataFields",rEC11.personalDataFields,   1);
assert("EC11c formIndex == -1",             rEC11.fields[0].formIndex,  -1);
assert("EC11d forms == 0",                  rEC11.forms,                 0);
assertSum("EC11e", rEC11);

// ── EC12 — cross-origin and same-origin iframes  [DESIGN VERIFIED] ──
sec("EC12 iframes  [DESIGN VERIFIED — browser test NOT RUN]");
console.log("  scanner.js calls document.querySelectorAll on its own frame only.");
console.log("  Cross-origin iframes: browser blocks access; scanner never tries.");
console.log("  Same-origin iframes: each frame gets its own content-script instance.");
console.log("  Multi-frame SCAN_RESULT merging: background.js responsibility (Tanishq).");
console.log("  If all_frames injection is needed, Tanishq must update manifest.json.");
console.log("  No scanner.js change needed. No manifest permission added by Varsha.");

// ── Full unit classification suite ───────────────────────────
sec("Unit tests — classification");
[
  ["name","name"],["first_name","name"],["last_name","name"],["full_name","name"],
  ["fullname","name"],["username","name"],["user_name","name"],["display_name","name"],
  ["fname","name"],["lname","name"],["middlename","name"],["middle_name","name"],
  ["company_name",null],["product_name",null],["domain_name",null],
  ["hotel_name",null],["store_name",null],["brand_name",null],
  ["password","password"],["confirm_password","password"],
  ["new_password","password"],["current_password","password"],
  ["passport","governmentId"],["passport_number","governmentId"],
  ["phone","phone"],["mobile","phone"],["telephone","phone"],
  ["tel","phone"],["tel_number","phone"],
  ["hotel",null],["motel",null],
  ["pan_card","governmentId"],["pan_number","governmentId"],
  ["aadhaar_number","governmentId"],["ssn","governmentId"],
  ["ration_card","governmentId"],["ration","governmentId"],
  ["panelId",null],["expansion",null],["rationalise",null],
  ["email","email"],["e_mail","email"],
  ["address","address"],["street","address"],["pincode","address"],
  ["state","address"],["city","address"],["zip","address"],
  ["zip_code","address"],["state_code","address"],
  ["statement",null],["unzip",null],["electricity",null],["publicity",null],["estate",null],
  ["dob","dob"],["date_of_birth","dob"],["birthday","dob"],["born","dob"],
  ["airborne",null],["newborn",null],
  ["credit_card","financial"],["card_number","financial"],
  ["cvv","financial"],["ifsc_code","financial"],["card","financial"],
  ["discard",null],["scorecard",null]
].forEach(function(p){ assert("cls(" + p[0] + ")", cls(p[0]), p[1]); });

sec("Unit tests — type= shortcuts");
[["email","email"],["tel","phone"],["password","password"],
 ["text",null],["number",null],["date",null]]
  .forEach(function(p){
    assert("type=" + p[0], classify(makeInput({type:p[0]})), p[1]);
  });

sec("Unit tests — contract shape (empty page)");
var empty = scanPage([], []);
["name","email","phone","address","dob","password","financial","governmentId"]
  .forEach(function(k){ assert("empty." + k, empty.fieldTypes[k], 0); });
assert("empty.forms",    empty.forms,              0);
assert("empty.pdf",      empty.personalDataFields, 0);
assert("empty.is array", Array.isArray(empty.fields), true);
assert("empty.length",   empty.fields.length,      0);

sec("Unit tests — fields[] never contain .value");
r1.fields.forEach(function(f){ assert("r1 " + f.name + " no .value", "value" in f, false); });
r2.fields.forEach(function(f){ assert("r2 " + f.name + " no .value", "value" in f, false); });
assertSum("T1 re-check", r1); assertSum("T2 re-check", r2);

// ── Summary ───────────────────────────────────────────────────
sec("SUMMARY");
console.log("Total:  " + (passed + failed));
console.log("Passed: " + passed);
console.log("Failed: " + failed);
if (failures.length) {
  console.log("\nFailing assertions:");
  failures.forEach(function(f){ console.log("  " + f.replace(/\n/g, "\n  ")); });
}
console.log([
  "",
  "=".repeat(64),
  "EDGE CASE EXECUTION STATUS",
  "=".repeat(64),
  "EC1  label[for=id]             RUN (simulated DOM)",
  "EC2  nested <label>            RUN (simulated DOM)",
  "EC3  aria-label/labelledby     RUN (simulated DOM)",
  "EC4  attribute-only            RUN (simulated DOM)",
  "EC5  dynamic fields            NOT RUN -- DESIGN VERIFIED correct",
  "EC6  form= attribute           RUN (simulated DOM) -- limitation noted",
  "EC7  duplicate elements        RUN (simulated DOM)",
  "EC8  SKIP_TYPES + number/date  RUN (simulated DOM)",
  "EC9  misleading substrings     RUN (simulated DOM)",
  "EC10 pass/passport/PAN/phone   RUN (simulated DOM)",
  "EC11 standalone inputs         RUN (simulated DOM)",
  "EC12 iframes                   NOT RUN -- DESIGN VERIFIED",
  "",
  "test-pages/*.html              PLACEHOLDER (Phase-3, Tanishq) -- NOT RUN",
  "Browser integration tests      NOT RUN (requires Chrome)",
  "=".repeat(64)
].join("\n"));
process.exit(failed > 0 ? 1 : 0);
