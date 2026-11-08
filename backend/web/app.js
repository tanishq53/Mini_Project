import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  setPersistence,
  signOut,
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

const $ = (selector) => document.querySelector(selector);
const authView = $("#auth-view");
const dashboardView = $("#dashboard-view");
const authForm = $("#auth-form");
let authMode = "login";
let connected = false;
let currentPeriod = "week";
let historyRequest = 0;
let historyRefreshTimer = null;
let backgroundRefreshInFlight = false;
let auth = null;
let currentHistory = null;
let lastHistoryUpdatedAt = null;

const themeToggle = $("#theme-toggle");
function setTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  themeToggle.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} theme`);
  themeToggle.title = `Switch to ${dark ? "light" : "dark"} theme`;
  $("#theme-label").textContent = dark ? "Light mode" : "Dark mode";
  $(".theme-icon").textContent = dark ? "☀" : "☾";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#111714" : "#f3f4ef";
}

setTheme(document.documentElement.dataset.theme || "light");
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("privacyguard-theme", next); } catch { /* Theme still applies for this page. */ }
  setTheme(next);
});

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (auth?.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    cache: "no-store",
    headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || "Something went wrong. Please try again.");
  return payload;
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    const active = button.dataset.authMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("#auth-heading").textContent = mode === "login" ? "Welcome back" : "Create your account";
  $("#auth-intro").textContent = mode === "login" ? "Sign in to view your scan history." : "Your account keeps your scan history in one place.";
  $("#auth-submit").textContent = mode === "login" ? "Sign in" : "Create account";
  $("#password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("#auth-error").hidden = true;
}

function showMessage(message) {
  const node = $("#dashboard-message");
  node.textContent = message;
  node.hidden = false;
}

function animateView(view) {
  view.classList.remove("view-enter");
  // Restart the short entrance animation when switching between auth and dashboard.
  void view.offsetWidth;
  view.classList.add("view-enter");
}

function riskClass(level) {
  return `risk-${String(level || "").toLowerCase().replaceAll(" ", "-")}`;
}

function renderChart(byDay, period) {
  const container = $("#activity-chart");
  container.replaceChildren();
  const count = period === "week" ? 7 : 30;
  const points = [];
  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(utcToday);
    date.setUTCDate(utcToday.getUTCDate() - i);
    points.push(date);
  }
  const counts = new Map(byDay.map((item) => [item.date, item.visits]));
  if (period === "day") {
    points.splice(0, points.length - 1, new Date(utcToday));
  }
  const values = period === "day"
    ? [byDay.reduce((total, item) => total + item.visits, 0)]
    : points.map((date) => counts.get(date.toISOString().slice(0, 10)) || 0);
  const max = Math.max(1, ...values);
  points.forEach((date, index) => {
    const column = document.createElement("div");
    column.className = "chart-column";
    const countLabel = document.createElement("span");
    countLabel.className = "chart-count";
    countLabel.textContent = values[index] ? String(values[index]) : "";
    const track = document.createElement("div");
    track.className = "chart-track";
    const bar = document.createElement("div");
    bar.className = `chart-bar${values[index] ? " active" : ""}`;
    bar.style.height = `${Math.max(values[index] ? 8 : 2, values[index] / max * 100)}%`;
    track.append(bar);
    const label = document.createElement("span");
    label.className = "chart-label";
    label.textContent = period === "day" ? "Last 24h" : period === "week"
      ? new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(date)
      : index % 5 === 0 || index === points.length - 1
        ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(date)
        : "";
    column.append(countLabel, track, label);
    container.append(column);
  });
}

function renderSites(sites) {
  const body = $("#top-sites");
  body.replaceChildren();
  const query = $("#site-filter").value.trim().toLowerCase();
  const exposureFilter = $("#exposure-filter").value;
  const allSites = currentHistory?.allSites || sites;
  const visible = [...allSites]
    .filter((site) => !query || site.hostname.toLowerCase().includes(query))
    .filter((site) => exposureFilter === "all" || exposureForScore(site.maxScore).toLowerCase() === exposureFilter.replace("-", " "))
    .sort((a, b) => b.visits - a.visits || a.hostname.localeCompare(b.hostname));
  $("#sites-empty").hidden = visible.length > 0;
  $("#sites-empty").textContent = allSites.length ? "No sites match these filters." : "No scans in this period yet.";
  visible.forEach((site) => {
    const row = document.createElement("tr");
    const host = document.createElement("td"); host.textContent = site.hostname;
    const visits = document.createElement("td"); visits.textContent = String(site.visits);
    const score = document.createElement("td"); score.textContent = `${site.minScore}–${site.maxScore}`;
    score.className = riskClass(site.maxScore >= 76 ? "very high" : site.maxScore >= 51 ? "high" : site.maxScore >= 26 ? "moderate" : "low");
    const factors = document.createElement("td");
    const breakdown = site.breakdown;
    factors.textContent = breakdown
      ? `Data ${breakdown.personalData ?? 0} · Trackers ${breakdown.trackers ?? 0} · Security ${breakdown.security ?? 0}`
      : "Details unavailable";
    factors.className = "score-factors";
    row.append(host, visits, score, factors); body.append(row);
  });
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadHistoryCsv() {
  if (!currentHistory) return;
  const rows = [["Website", "Last scanned", "Scans", "Minimum score", "Maximum score", "Exposure", "Data points", "Tracker points", "Security points", "TLS status"]];
  const sites = currentHistory.allSites || currentHistory.visits || [];
  sites.forEach((site) => rows.push([
    site.hostname,
    site.visitedAt ? new Date(site.visitedAt).toISOString() : "",
    site.visits ?? 1,
    site.minScore ?? site.riskScore ?? "",
    site.maxScore ?? site.riskScore ?? "",
    exposureForScore(Number(site.maxScore ?? site.riskScore ?? 0)),
    site.breakdown?.personalData ?? "",
    site.breakdown?.trackers ?? "",
    site.breakdown?.security ?? "",
    site.tls || "Not checked"
  ]));
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `privacyguard-${currentPeriod}-history-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function renderRecent(visits) {
  const list = $("#recent-visits");
  list.replaceChildren();
  $("#recent-empty").hidden = visits.length > 0;
  visits.slice(0, 8).forEach((visit) => {
    const item = document.createElement("li"); item.className = "recent-item";
    const host = document.createElement("span"); host.className = "recent-host"; host.textContent = visit.hostname;
    const time = document.createElement("time"); time.className = "recent-time"; time.dateTime = visit.visitedAt;
    time.textContent = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(visit.visitedAt));
    const detail = document.createElement("span"); detail.className = "recent-meta";
    detail.textContent = `${visit.visits} scan${visit.visits === 1 ? "" : "s"} · score range`;
    const level = document.createElement("span"); level.className = `recent-badge ${riskClass(visit.maxScore >= 76 ? "very high" : visit.maxScore >= 51 ? "high" : visit.maxScore >= 26 ? "moderate" : "low")}`;
    level.textContent = `${visit.minScore}–${visit.maxScore}`;
    item.append(host, time, detail, level); list.append(item);
  });
}

function exposureForScore(score) {
  if (score >= 76) return "Very high";
  if (score >= 51) return "High";
  if (score >= 26) return "Moderate";
  return "Low";
}

function pdfSafeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function makeHistoryPdf(history, period) {
  const width = 595;
  const height = 842;
  const margin = 48;
  const right = width - margin;
  const pageCommands = [];
  let commands = [];
  let y = 0;
  const today = new Date();
  const generated = new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(today);
  const periodTitle = { day: "Day", week: "Week", month: "Month" }[period] || "Week";

  const text = (value, x, top, size = 10, bold = false, color = "0.10 0.16 0.13") => {
    commands.push(`${color} rg BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${height - top} Td (${pdfSafeText(value)}) Tj ET`);
  };
  const rule = (top, x1 = margin, x2 = right) => commands.push(`0.82 0.86 0.83 RG 0.7 w ${x1} ${height - top} m ${x2} ${height - top} l S`);
  const beginPage = (continued = false) => {
    commands = [];
    text("PrivacyGuard", margin, 52, 10, true, "0.13 0.39 0.29");
    text("Browsing history report", margin, 82, 24, true);
    text(`${periodTitle} activity${continued ? " - continued" : ""}  |  Generated ${generated}`, margin, 101, 10, false, "0.36 0.42 0.38");
    rule(116);
    if (!continued) {
      text(`${history.totalVisits} scans`, margin, 142, 12, true);
      text(`${history.uniqueSites} unique sites`, margin + 150, 142, 12, true);
      text(`Period: ${period === "day" ? "today" : `past ${period === "week" ? "7" : "30"} days`}`, margin, 162, 9, false, "0.36 0.42 0.38");
      text("SITE ACTIVITY", margin, 194, 9, true, "0.13 0.39 0.29");
      rule(204);
      y = 226;
    } else {
      text("Site activity", margin, 139, 9, true, "0.13 0.39 0.29");
      rule(149);
      y = 170;
    }
  };
  const finishPage = () => {
    rule(800);
    text("PrivacyGuard privacy exposure summary. This is not a guarantee that a site is safe or trustworthy.", margin, 818, 8, false, "0.36 0.42 0.38");
    pageCommands.push(commands.join("\n"));
  };

  beginPage();
  const sites = history.allSites || history.visits || [];
  if (!sites.length) {
    text("No sites were scanned during this period.", margin, y + 4, 11, false, "0.36 0.42 0.38");
  } else {
    sites.forEach((site) => {
      if (y > 750) { finishPage(); beginPage(true); }
      const min = Number(site.minScore ?? site.riskScore ?? 0);
      const max = Number(site.maxScore ?? site.riskScore ?? 0);
      const exposure = exposureForScore(max);
      const tls = site.tls === "secure" ? "TLS trusted" : site.tls === "insecure" ? "TLS certificate not trusted" : site.tls === "broken" ? "TLS check failed" : "TLS not checked";
      const visitedAt = site.visitedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(site.visitedAt)) : "Time unavailable";
      text(site.hostname || "Unknown site", margin, y, 12, true);
      text(`Last scanned: ${visitedAt}`, margin, y + 16, 9, false, "0.36 0.42 0.38");
      text(`Scans: ${site.visits ?? 1}   |   Privacy exposure score: ${min}-${max}/100 (${exposure})`, margin, y + 31, 9);
      const factors = site.breakdown
        ? `Highest score factors: data ${site.breakdown.personalData ?? 0} · trackers ${site.breakdown.trackers ?? 0} · security ${site.breakdown.security ?? 0}`
        : "Score factors: details unavailable for older scans";
      text(factors, margin, y + 46, 8, false, "0.36 0.42 0.38");
      text(`Connection check: ${tls}`, margin, y + 59, 9, false, "0.36 0.42 0.38");
      rule(y + 71);
      y += 89;
    });
  }
  finishPage();

  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  const pageRefs = pageCommands.map((_, index) => `${5 + index * 2} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${pageRefs}] /Count ${pageCommands.length} >>`;
  pageCommands.forEach((content, index) => {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    const length = new TextEncoder().encode(content).length;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${length} >>\nstream\n${content}\nendstream`;
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = new TextEncoder().encode(pdf).length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([new TextEncoder().encode(pdf)], { type: "application/pdf" });
}

function downloadHistoryPdf() {
  if (!currentHistory) return;
  const blob = makeHistoryPdf(currentHistory, currentPeriod);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `privacyguard-${currentPeriod}-history-${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Chrome may still be reading the Blob when the download dialog opens.
  // Keep its object URL alive long enough for the download to finish.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function loadHistory(period = currentPeriod, { quiet = false } = {}) {
  const requestId = ++historyRequest;
  currentPeriod = period;
  const periodButtons = document.querySelectorAll("[data-period]");
  periodButtons.forEach((button) => {
    const selected = button.dataset.period === period;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  if (!quiet) {
    currentHistory = null;
    $("#download-report").disabled = true;
    $("#download-csv").disabled = true;
  }
  $("#activity-chart").setAttribute("aria-busy", "true");
  let history;
  try {
    history = await api(`/api/history?period=${period}`);
  } catch (error) {
    if (requestId === historyRequest) $("#activity-chart").removeAttribute("aria-busy");
    if (requestId === historyRequest) {
      const updated = lastHistoryUpdatedAt
        ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(lastHistoryUpdatedAt)
        : null;
      $("#history-sync-status").textContent = updated ? `Could not refresh. Showing data from ${updated}.` : "Could not load history. Check the dashboard connection.";
    }
    throw error;
  }
  if (requestId !== historyRequest) return;
  currentHistory = history;
  lastHistoryUpdatedAt = new Date();
  const updated = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(lastHistoryUpdatedAt);
  $("#history-sync-status").textContent = `Updated ${updated} · checking every 5 seconds`;
  $("#download-report").disabled = false;
  $("#download-csv").disabled = false;
  $("#total-visits").textContent = String(history.totalVisits);
  $("#unique-sites").textContent = String(history.uniqueSites);
  const daysShown = history.effectiveDays || { day: 1, week: 7, month: 30 }[period];
  $("#period-caption").textContent = period === "day" ? "today" : `in the past ${daysShown} days${daysShown < (period === "week" ? 7 : 30) ? " · retention limit" : ""}`;
  renderChart(history.byDay, period === "month" && daysShown < 30 ? "week" : period);
  renderSites(history.allSites || history.topSites);
  renderRecent(history.visits);
  $("#activity-chart").removeAttribute("aria-busy");
  if (!quiet) {
    ["#activity-chart", ".site-section .table-wrap", "#recent-visits"].forEach((selector) => {
      const element = $(selector);
      element.classList.remove("period-enter");
      void element.offsetWidth;
      element.classList.add("period-enter");
    });
  }
}

$("#download-report").addEventListener("click", downloadHistoryPdf);
$("#download-csv").addEventListener("click", downloadHistoryCsv);
$("#site-filter").addEventListener("input", () => renderSites(currentHistory?.allSites || []));
$("#exposure-filter").addEventListener("change", () => renderSites(currentHistory?.allSites || []));
$("#history-retention").addEventListener("change", async (event) => {
  const select = event.currentTarget;
  const previous = select.value === "7" ? "30" : "7";
  if (select.value === "7" && !confirm("Keeping 7 days will permanently delete older saved history. Continue?")) {
    select.value = previous;
    return;
  }
  select.disabled = true;
  try {
    await api("/api/history/retention", { method: "PUT", body: JSON.stringify({ days: Number(select.value) }) });
    showMessage(`History retention set to ${select.value} days.`);
  } catch (error) {
    select.value = previous;
    showMessage(error.message);
    select.disabled = false;
    return;
  }
  select.disabled = false;
  try { await loadHistory(currentPeriod); }
  catch (error) { showMessage(error.message); }
});

function refreshHistoryInBackground() {
  if (!auth?.currentUser || dashboardView.hidden || backgroundRefreshInFlight) return;
  backgroundRefreshInFlight = true;
  loadHistory(currentPeriod, { quiet: true }).catch(() => {
    // Keep the current dashboard data visible if a background refresh fails.
  }).finally(() => { backgroundRefreshInFlight = false; });
}

function startHistoryAutoRefresh() {
  clearInterval(historyRefreshTimer);
  refreshHistoryInBackground();
  historyRefreshTimer = setInterval(refreshHistoryInBackground, 5000);
}

function stopHistoryAutoRefresh() {
  clearInterval(historyRefreshTimer);
  historyRefreshTimer = null;
  backgroundRefreshInFlight = false;
}

async function showDashboard(user) {
  authView.hidden = true;
  dashboardView.hidden = false;
  animateView(dashboardView);
  $("#signed-in-nav").hidden = false;
  $("#account-email").textContent = user.email;
  try {
    const retention = await api("/api/history/retention");
    $("#history-retention").value = String(retention.days);
  } catch { /* History loading below surfaces account or backend errors. */ }
  try {
    connected = (await api("/api/extension-key")).connected;
    $("#connection-state").textContent = connected ? "Key active" : "Not connected";
    $("#connect-action").hidden = connected;
    $("#revoke-key").hidden = !connected;
    $("#connect-open").textContent = connected ? "Manage connection →" : "Connect extension →";
  } catch { /* history loading below will surface an expired session */ }
  try {
    await loadHistory();
    startHistoryAutoRefresh();
  } catch (error) {
    showMessage(error.message);
    startHistoryAutoRefresh();
  }
}

function showAuth() {
  stopHistoryAutoRefresh();
  authView.hidden = false;
  dashboardView.hidden = true;
  $("#signed-in-nav").hidden = true;
  animateView(authView);
}

function authMessage(error) {
  const messages = {
    "auth/email-already-in-use": "An account already exists for this email. Sign in instead.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/user-not-found": "No account was found for that email.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/weak-password": "Choose a stronger password with at least 10 characters.",
    "auth/operation-not-allowed": "Enable Email/Password sign-in in Firebase Authentication settings.",
    "auth/too-many-requests": "Too many attempts. Wait a little and try again.",
    "auth/network-request-failed": "Could not reach Firebase. Check your internet connection."
  };
  return messages[error.code] || error.message || "Firebase could not complete that request.";
}

document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorNode = $("#auth-error");
  errorNode.hidden = true;
  const submit = $("#auth-submit"); submit.disabled = true;
  try {
    const email = $("#email").value.trim();
    const password = $("#password").value;
    if (authMode === "register") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(credential.user);
      await signOut(auth);
      errorNode.textContent = "Check your inbox for a Firebase verification link, then return here to sign in.";
      errorNode.hidden = false;
    } else {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await reload(credential.user);
      if (!credential.user.emailVerified) {
        await sendEmailVerification(credential.user);
        await signOut(auth);
        throw new Error("Verify your email first. Firebase has sent a fresh verification link.");
      }
      authForm.reset();
      await showDashboard({ email: credential.user.email });
    }
  } catch (error) {
    errorNode.textContent = error.code ? authMessage(error) : error.message;
    errorNode.hidden = false;
  } finally { submit.disabled = false; }
});

document.querySelectorAll("[data-period]").forEach((button) => button.addEventListener("click", () => {
  loadHistory(button.dataset.period).catch((error) => showMessage(error.message));
}));

$("#logout-button").addEventListener("click", async () => {
  const button = $("#logout-button");
  button.disabled = true;
  try {
    await signOut(auth);
    showAuth();
  } catch (error) {
    showMessage(authMessage(error));
  } finally {
    button.disabled = false;
  }
});

$("#connect-open").addEventListener("click", () => { $("#connect-panel").hidden = false; $("#connect-panel").scrollIntoView({ behavior: "smooth", block: "center" }); });
$("#create-key").addEventListener("click", async () => {
  const button = $("#create-key"); button.disabled = true;
  try {
    const result = await api("/api/extension-key", { method: "POST", body: "{}" });
    $("#extension-key").value = result.token;
    $("#connect-action").hidden = true; $("#key-result").hidden = false;
    $("#connection-state").textContent = "Key active";
    connected = true;
    $("#revoke-key").hidden = true;
  } catch (error) { showMessage(error.message); }
  finally { button.disabled = false; }
});
$("#copy-key").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("#extension-key").value); $("#copy-key").textContent = "Copied"; }
  catch { $("#extension-key").select(); document.execCommand("copy"); $("#copy-key").textContent = "Copied"; }
});
$("#key-done").addEventListener("click", () => {
  $("#extension-key").value = "";
  $("#connection-state").textContent = "Key active";
  $("#key-result").hidden = true; $("#connect-action").hidden = connected;
  $("#revoke-key").hidden = !connected;
  $("#connect-panel").scrollIntoView({ behavior: "smooth", block: "center" });
  showMessage("In Chrome, open PrivacyGuard’s extension settings and paste the copied key. New scans will then appear here.");
});
$("#revoke-key").addEventListener("click", async () => {
  if (!confirm("Disconnect the extension? It will stop adding scans to this account.")) return;
  try {
    await api("/api/extension-key", { method: "DELETE" });
    connected = false;
    $("#connection-state").textContent = "Not connected";
    $("#revoke-key").hidden = true;
    $("#connect-action").hidden = false;
    $("#connect-open").textContent = "Connect extension →";
    showMessage("Extension disconnected. Existing history was kept.");
  } catch (error) { showMessage(error.message); }
});
$("#clear-history").addEventListener("click", async () => {
  if (!confirm("Permanently clear all saved visit history for this account?")) return;
  try { await api("/api/history", { method: "DELETE" }); await loadHistory(); showMessage("Your visit history has been cleared."); }
  catch (error) { showMessage(error.message); }
});

async function startFirebase() {
  try {
    const response = await fetch("/api/firebase-config");
    const data = await response.json();
    if (!response.ok || !data.configured) {
      showAuth();
      $("#auth-error").textContent = "Firebase is not configured yet. Add the Firebase Web App values to backend/.env, then restart the backend.";
      $("#auth-error").hidden = false;
      $("#auth-submit").disabled = true;
      return;
    }
    const app = initializeApp(data.config);
    auth = getAuth(app);
    await setPersistence(auth, browserLocalPersistence);
    onAuthStateChanged(auth, (user) => {
      if (user?.emailVerified) showDashboard({ email: user.email });
      else showAuth();
    });
  } catch (error) {
    showAuth();
    $("#auth-error").textContent = `Could not initialize Firebase: ${error.message}`;
    $("#auth-error").hidden = false;
    $("#auth-submit").disabled = true;
  }
}

startFirebase();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshHistoryInBackground();
});
window.addEventListener("focus", refreshHistoryInBackground);
window.addEventListener("pageshow", refreshHistoryInBackground);
