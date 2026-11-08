// Owner: Tanishq. Talks to the FastAPI backend. Every failure becomes the contract's
// error object (docs/contract.md, error format) so the panel can show it.
import { BACKEND_URL, SCAN_TIMEOUT_MS } from "./config.js";

function backendError(message) {
  return { error: true, code: "BACKEND_UNREACHABLE", message };
}

export async function postScan(scan, { saveHistory = false } = {}) {
  // AbortController stops a hung request instead of leaving the panel loading forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const stored = await chrome.storage.local.get("privacyGuard.apiToken");
    const token = stored["privacyGuard.apiToken"];
    const headers = { "Content-Type": "application/json" };
    if (saveHistory && typeof token === "string" && token.startsWith("pg_")) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${BACKEND_URL}/scan`, {
      method: "POST",
      headers,
      body: JSON.stringify(scan),
      signal: controller.signal
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // The backend already answers with the contract error shape; pass it through.
      throw body && body.error ? body : backendError(`Server returned HTTP ${res.status}.`);
    }
    return body;
  } catch (err) {
    if (err && err.error) throw err;
    throw backendError("Could not reach the PrivacyGuard server. Is it running on " + BACKEND_URL + "?");
  } finally {
    clearTimeout(timer);
  }
}

export async function checkSiteReputation(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const res = await fetch(`${BACKEND_URL}/reputation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`Reputation service returned HTTP ${res.status}.`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzePageContent(url, pageText) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50000);
  try {
    const stored = await chrome.storage.local.get("privacyGuard.apiToken");
    const token = stored["privacyGuard.apiToken"];
    if (typeof token !== "string" || !token.startsWith("pg_")) {
      throw { error: true, code: "EXTENSION_AUTH_REQUIRED", message: "Connect the extension to your account in the dashboard options first." };
    }
    const response = await fetch(`${BACKEND_URL}/analyze-policy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url, pageText }),
      signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) {
        throw { error: true, code: "EXTENSION_AUTH_REQUIRED", message: body?.detail || "Connect the extension to your account in the dashboard options first." };
      }
      const message = body?.detail || body?.message || `Analysis service returned HTTP ${response.status}.`;
      throw { error: true, code: "GEMINI_FAILED", message };
    }
    return body;
  } catch (error) {
    if (error?.error) throw error;
    throw { error: true, code: "GEMINI_FAILED", message: "Could not reach the analysis service. Check that the backend and Gemini API key are configured." };
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzePolicyDocuments(origin, documents) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50000);
  try {
    const stored = await chrome.storage.local.get("privacyGuard.apiToken");
    const token = stored["privacyGuard.apiToken"];
    if (typeof token !== "string" || !token.startsWith("pg_")) {
      throw { error: true, code: "EXTENSION_AUTH_REQUIRED", message: "Connect the extension to your account in the dashboard options first." };
    }
    const response = await fetch(`${BACKEND_URL}/analyze-policies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ origin, documents }),
      signal: controller.signal
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
