// PrivacyGuard's extension client. Account keys are sent only where the backend
// records or analyzes account-linked scans; page contents are never persisted.
import { BACKEND_URL, SCAN_TIMEOUT_MS } from "./config.js";

function backendError(message) {
  return { error: true, code: "BACKEND_UNREACHABLE", message };
}

async function settings() {
  const stored = await chrome.storage.local.get(["privacyGuardBackendUrl", "privacyGuard.apiToken"]);
  return {
    backendUrl: (stored.privacyGuardBackendUrl || BACKEND_URL).replace(/\/+$/, ""),
    token: stored["privacyGuard.apiToken"]
  };
}

export async function postScan(scan, { saveHistory = false } = {}) {
  const { backendUrl, token } = await settings();
  const headers = { "Content-Type": "application/json" };
  if (typeof token === "string" && token.startsWith("pg_")) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (saveHistory) headers["X-PrivacyGuard-Save-History"] = "true";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const res = await fetch(`${backendUrl}/scan`, {
      method: "POST", headers, body: JSON.stringify(scan), signal: controller.signal
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw body && body.error ? body : backendError(`Server returned HTTP ${res.status}.`);
    return body;
  } catch (err) {
    if (err && err.error) throw err;
    throw backendError(`Could not reach the PrivacyGuard server. Is it running on ${backendUrl}?`);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkSiteReputation(url) {
  const { backendUrl } = await settings();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const res = await fetch(`${backendUrl}/reputation`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }), signal: controller.signal
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Reputation service returned HTTP ${res.status}.`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function analyze(path, payload) {
  const { backendUrl, token } = await settings();
  if (typeof token !== "string" || !token.startsWith("pg_")) {
    throw { error: true, code: "EXTENSION_AUTH_REQUIRED", message: "Connect the extension to your account in the dashboard options first." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50000);
  try {
    const response = await fetch(`${backendUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload), signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) {
        throw { error: true, code: "EXTENSION_AUTH_REQUIRED", message: body?.detail || "Connect the extension to your account in the dashboard options first." };
      }
      throw { error: true, code: "GEMINI_FAILED", message: body?.detail || body?.message || `Analysis service returned HTTP ${response.status}.` };
    }
    return body;
  } catch (error) {
    if (error?.error) throw error;
    throw { error: true, code: "GEMINI_FAILED", message: "Could not reach the analysis service. Check that the backend and Gemini API key are configured." };
  } finally {
    clearTimeout(timer);
  }
}

export function analyzePageContent(url, pageText) {
  return analyze("/analyze-policy", { url, pageText });
}

export function analyzePolicyDocuments(origin, documents) {
  return analyze("/analyze-policies", { origin, documents });
}
