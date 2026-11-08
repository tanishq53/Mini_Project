const TOKEN_KEY = "privacyGuard.apiToken";
const form = document.querySelector("#settings-form");
const input = document.querySelector("#api-key");
const state = document.querySelector("#state");
const clearButton = document.querySelector("#clear-key");

function showState(message, error = false) {
  state.textContent = message;
  state.classList.toggle("error", error);
  state.hidden = false;
}

async function refreshState() {
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  const connected = typeof stored[TOKEN_KEY] === "string" && stored[TOKEN_KEY].startsWith("pg_");
  clearButton.hidden = !connected;
  showState(connected ? "This extension is connected to your account." : "No account is connected yet.");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = input.value.trim();
  if (!token.startsWith("pg_") || token.length < 32) {
    showState("That key does not look valid. Copy it from the PrivacyGuard dashboard.", true);
    return;
  }
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
  input.value = "";
  await refreshState();
  showState("Key saved. New scans will be added to your history.");
});

clearButton.addEventListener("click", async () => {
  await chrome.storage.local.remove(TOKEN_KEY);
  input.value = "";
  await refreshState();
  showState("This browser is disconnected. Your saved history remains in your account.");
});

refreshState().catch(() => showState("Could not read extension storage. Reload the extension and try again.", true));
