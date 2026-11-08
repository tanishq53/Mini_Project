const form = document.getElementById("settings-form");
const urlInput = document.getElementById("backend-url");
const tokenInput = document.getElementById("api-token");
const status = document.getElementById("status");

const defaults = await chrome.storage.local.get(["privacyGuardBackendUrl", "privacyGuardApiToken"]);
urlInput.value = defaults.privacyGuardBackendUrl || "http://localhost:8000";
tokenInput.value = defaults.privacyGuardApiToken || "";

function validateBackendUrl(value) {
  const url = new URL(value);
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Use an HTTP or HTTPS backend URL.");
  }
  if (!localHost && url.protocol !== "https:") {
    throw new Error("Remote backend URLs must use HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Do not put credentials, query strings, or fragments in the backend URL.");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const backendUrl = validateBackendUrl(urlInput.value.trim());
    await chrome.storage.local.set({
      privacyGuardBackendUrl: backendUrl,
      privacyGuardApiToken: tokenInput.value.trim()
    });
    status.textContent = "Settings saved.";
  } catch (error) {
    status.textContent = error.message || "Could not save settings.";
  }
});
