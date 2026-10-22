// Owner: Tanishq. Keep the latest report in this browser session, keyed by tab.
const REPORT_PREFIX = "privacyGuard.report.";

const reportKey = (tabId) => `${REPORT_PREFIX}${tabId}`;

export async function saveReport(tabId, report) {
  if (!Number.isInteger(tabId) || !report) return;
  await chrome.storage.session.set({ [reportKey(tabId)]: report });
}

export async function getReport(tabId) {
  if (!Number.isInteger(tabId)) return null;
  const key = reportKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] ?? null;
}

export async function removeReport(tabId) {
  if (!Number.isInteger(tabId)) return;
  await chrome.storage.session.remove(reportKey(tabId));
}
