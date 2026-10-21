// Development helper, shown only when USE_MOCK is true. Owner: Tanishq.
// Pick which mock scenario the next scan returns, then press Scan or Rescan as a user would.
import { SCENARIOS, ERRORS } from "../mockData.js";
import { setMockScenario, setMockAnalyzeFails } from "./source.js";

function group(label, names, prefix = "") {
    const g = document.createElement("optgroup");
    g.label = label;
    for (const name of names) {
        const o = document.createElement("option");
        o.value = prefix + name;
        o.textContent = name;
        g.append(o);
    }
    return g;
}

export function mountDevPicker() {
    const bar = document.createElement("div");
    bar.style.cssText = "margin-bottom:12px;padding:8px;border:1px dashed currentColor;font-size:12px";

    const label = document.createElement("label");
    label.textContent = "Dev: scenario for the next scan";
    label.style.display = "block";

    const select = document.createElement("select");
    select.style.cssText = "width:100%;margin:4px 0;padding:4px";
    select.append(group("Reports", Object.keys(SCENARIOS)), group("Errors", Object.keys(ERRORS), "error:"));
    select.value = "highRisk";
    select.addEventListener("change", () => setMockScenario(select.value));

    const failLabel = document.createElement("label");
    const fail = document.createElement("input");
    fail.type = "checkbox";
    fail.addEventListener("change", () => setMockAnalyzeFails(fail.checked));
    failLabel.append(fail, " Make Analyze policy fail");

    bar.append(label, select, failLabel);
    document.body.prepend(bar);
}