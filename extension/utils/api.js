// Owner: Tanishq. Talks to the FastAPI backend. Every failure becomes the contract's
// error object (docs/contract.md, error format) so the panel can show it.
import { BACKEND_URL, SCAN_TIMEOUT_MS } from "./config.js";

function backendError(message) {
  return { error: true, code: "BACKEND_UNREACHABLE", message };
}

export async function postScan(scan) {
  // AbortController stops a hung request instead of leaving the panel loading forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const res = await fetch(`${BACKEND_URL}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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