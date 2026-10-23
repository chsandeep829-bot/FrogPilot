const $ = (id) => document.getElementById(id);
let currentJobId = null, pollTimer = null, lastJobStatus = null;
let providerCounter = 0;

function getApiBase() {
  const field = $("backendUrl");
  return String(field?.value || "").trim().replace(/\\/+$/, "");
}
function saveBackendUrl() {
  try { sessionStorage.setItem("forgepilot-backend-url", getApiBase()); } catch {}
}
async function api(url, options = {}) {
  const base = getApiBase();
  const res = await fetch(base ? `${base}${url}` : url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: HTTP ${res.status}`);
  return data;
}
function fmtDate(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleString(); } catch { return value; }
}
function setBadge(text, type = "") { $("jobBadge").textContent = text; $("jobBadge").className = `badge ${type}`; }
function showError(message) { $("errorBox").textContent = message; $("errorBox").classList.remove("hidden"); }
function clearError() { $("errorBox").textContent = ""; $("errorBox").classList.add("hidden"); }

function addProvider(values = {}) {
  const id = ++providerCounter;
  const row = document.createElement("div");
  row.className = "provider-card";
  row.dataset.providerId = String(id);
  row.innerHTML = `
    <div class="provider-card-head"><strong>AI provider <span class="provider-number"></span></strong><button type="button" class="remove-provider secondary">Remove</button></div>
    <label>AI/provider name</label><input class="provider-name" maxlength="60" placeholder="e.g. Gemini-compatible gateway">
    <label>API base URL</label><input class="provider-url" type="url" placeholder="https://api.example.com/v1">
    <label>Model ID</label><input class="provider-model" placeholder="model-name">
    <label>API key</label><input class="provider-key" type="password" autocomplete="off" placeholder="Paste API key">
    <p class="provider-note">Fallback order follows the list from top to bottom.</p>`;
  row.querySelector(".provider-name").value = values.name || "";
  row.querySelector(".provider-url").value = values.baseUrl || "";
  row.querySelector(".provider-model").value = values.model || "";
  row.querySelector(".provider-key").value = values.apiKey || "";
  row.querySelector(".remove-provider").addEventListener("click", () => { row.remove(); renumberProviders(); saveProviders(); });
  row.querySelectorAll("input").forEach(input => input.addEventListener("input", saveProviders));
  $("providerList").appendChild(row);
  renumberProviders();
}
function renumberProviders() {
  document.querySelectorAll(".provider-card").forEach((row, i) => {
    row.querySelector(".provider-number").textContent = String(i + 1);
    row.querySelector(".remove-provider").disabled = document.querySelectorAll(".provider-card").length <= 1;
  });
}
function getProviders() {
  return [...document.querySelectorAll(".provider-card")].map(row => ({
    name: row.querySelector(".provider-name").value.trim(),
    baseUrl: row.querySelector(".provider-url").value.trim(),
    model: row.querySelector(".provider-model").value.trim(),
    apiKey: row.querySelector(".provider-key").value.trim()
  })).filter(p => p.name && p.baseUrl && p.model && p.apiKey);
}
function saveProviders() {
  try { sessionStorage.setItem("forgepilot-provider-session", JSON.stringify(getProviders())); } catch {}
}
function loadProviders() {
  let saved = [];
  try { saved = JSON.parse(sessionStorage.getItem("forgepilot-provider-session") || "[]"); } catch {}
  if (Array.isArray(saved) && saved.length) saved.forEach(addProvider);
  else addProvider();
}
async function checkHealth() {
  try {
    const data = await api("/api/health");
    $("serverStatus").textContent = `Server online · ${data.aiConfigured ? "server AI ready" : "use your provider keys"} · ${data.cloudflareConfigured ? "publish configured" : "publish setup needed"}`;
    document.querySelector(".dot").style.background = "#4adea1";
  } catch {
    $("serverStatus").textContent = "Backend unavailable — connect a Node.js API server";
    document.querySelector(".dot").style.background = "#fb7185";
  }
}
function switchTab(id) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === id));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === id));
}
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

function renderFiles(files) {
  $("fileList").replaceChildren();
  if (!files?.length) {
    const p = document.createElement("p"); p.className = "muted"; p.textContent = "No files yet."; $("fileList").appendChild(p); return;
  }
  for (const file of files) {
    const el = document.createElement("button");
    el.type = "button"; el.className = "file-pill"; el.textContent = file.path;
    el.addEventListener("click", () => {
      const found = files.find(f => f.path === file.path);
      $("chatInput").value = `Please edit ${found.path} to: `;
      switchTab("chatPanel"); $("chatInput").focus();
    });
    $("fileList").appendChild(el);
  }
  renderPreview(files);
}
function renderPreview(files) {
  const main = files.find(f => f.path === "index.html");
  if (!main) { $("preview").srcdoc = "<p>No index.html found.</p>"; return; }
  let html = main.content;
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const file of files.filter(f => f.path !== "index.html" && /\.css$/i.test(f.path))) {
    const basename = file.path.split("/").pop();
    const style = `<style>\n${file.content}\n</style>`;
    html = html.replace(new RegExp(`<link\\b[^>]*href=["'][^"']*(?:${basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})["'][^>]*>`, "gi"), style);
  }
  for (const file of files.filter(f => f.path !== "index.html" && /\.js$/i.test(f.path))) {
    const basename = file.path.split("/").pop();
    const script = `<script>\ntry {\n${file.content}\n} catch(e) { console.error(e); }\n<\\/script>`;
    html = html.replace(new RegExp(`<script\\b[^>]*src=["'][^"']*(?:${basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})["'][^>]*>\\s*<\\/script>`, "gi"), script);
  }
  $("preview").srcdoc = html;
}
function renderChat(messages) {
  const box = $("chatMessages"); box.replaceChildren();
  if (!messages?.length) {
    const p = document.createElement("p"); p.className = "muted"; p.textContent = "Your conversation will appear here."; box.appendChild(p); return;
  }
  for (const msg of messages) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${msg.role === "user" ? "user" : "assistant"}`;
    const who = document.createElement("strong"); who.textContent = msg.role === "user" ? "You" : `Agent${msg.provider ? " · " + msg.provider : ""}`;
    const body = document.createElement("p"); body.textContent = msg.content || "";
    bubble.append(who, body); box.appendChild(bubble);
  }
  box.scrollTop = box.scrollHeight;
}
async function loadJob(id) {
  const job = await api(`/api/jobs/${encodeURIComponent(id)}`);
  $("resultSection").classList.remove("hidden");
  $("resultTitle").textContent = job.name || "Project result";
  $("resultSubtitle").textContent = `Created ${fmtDate(job.createdAt)} · Finished ${fmtDate(job.finishedAt)}`;
  $("summary").textContent = job.summary || "";
  renderFiles(job.files); renderChat(job.chat || []);
  $("downloadBtn").disabled = job.status !== "completed";
  lastJobStatus = job.status; $("deployBtn").disabled = job.status !== "completed";
  if (job.deployment?.url) {
    $("deployStatus").textContent = `Published: ${job.deployment.url}`;
    $("deployStatus").className = "deploy-success";
  }
  if (job.status === "completed") setBadge("Completed", "good");
  else if (job.status === "failed") setBadge("Failed", "bad");
  else setBadge("Generating…");
  if (job.error) showError(job.error); else clearError();
  if (job.status !== "running" && pollTimer) {
    clearInterval(pollTimer); pollTimer = null;
    $("generateBtn").disabled = false; $("generateBtn").innerHTML = "<span>✦</span> Generate project";
  }
  await loadJobs();
}
async function loadJobs() {
  try {
    const data = await api("/api/jobs"); $("jobsList").replaceChildren();
    if (!data.jobs.length) { const p = document.createElement("p"); p.className = "muted"; p.textContent = "No projects yet."; $("jobsList").appendChild(p); return; }
    for (const job of data.jobs) {
      const row = document.createElement("div"); row.className = "job"; row.style.cursor = "pointer";
      const left = document.createElement("div"), title = document.createElement("strong"), meta = document.createElement("small"), right = document.createElement("div");
      title.textContent = job.name; meta.textContent = `${fmtDate(job.createdAt)} · ${job.fileCount || 0} files`;
      left.append(title, meta); right.className = "job-state"; right.textContent = job.status; row.append(left, right);
      row.addEventListener("click", () => { currentJobId = job.id; loadJob(job.id).catch(e => showError(e.message)); });
      $("jobsList").appendChild(row);
    }
  } catch (err) { $("jobsList").textContent = err.message; }
}
$("addProviderBtn").addEventListener("click", () => addProvider());
$("clearKeysBtn").addEventListener("click", () => {
  try { sessionStorage.removeItem("forgepilot-provider-session"); } catch {}
  $("providerList").replaceChildren(); addProvider();
});
$("generateBtn").addEventListener("click", async () => {
  const prompt = $("prompt").value.trim(), name = $("projectName").value.trim() || "my-app", providers = getProviders();
  clearError();
  if (prompt.length < 8) return showError("Please describe your app in at least 8 characters.");
  if (!providers.length) return showError("Fill in the provider name, API base URL, model ID, and API key for at least one provider.");
  $("generateBtn").disabled = true; $("generateBtn").textContent = "Generating…";
  $("resultSection").classList.remove("hidden"); $("resultTitle").textContent = name; $("resultSubtitle").textContent = "Trying configured providers in order…";
  $("summary").textContent = ""; renderFiles([]); renderChat([]); setBadge("Starting"); $("downloadBtn").disabled = true;
  try {
    const result = await api("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, name, providers }) });
    currentJobId = result.id; await loadJob(currentJobId);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => loadJob(currentJobId).catch(e => showError(e.message)), 2500);
  } catch (err) {
    showError(err.message); setBadge("Failed", "bad"); $("generateBtn").disabled = false; $("generateBtn").innerHTML = "<span>✦</span> Generate project";
  }
});
$("sendChatBtn").addEventListener("click", async () => {
  const message = $("chatInput").value.trim(), providers = getProviders();
  if (!currentJobId) return showError("Generate or open a project first.");
  if (message.length < 2) return;
  if (!providers.length) return showError("Add a valid AI provider before requesting edits.");
  $("sendChatBtn").disabled = true; $("sendChatBtn").textContent = "Editing…"; clearError();
  try {
    const result = await api(`/api/jobs/${encodeURIComponent(currentJobId)}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, providers })
    });
    $("chatInput").value = ""; await loadJob(currentJobId); switchTab("previewPanel");
    if (result.provider) $("resultSubtitle").textContent = `Updated using ${result.provider} · ${fmtDate(new Date().toISOString())}`;
  } catch (err) { showError(err.message); }
  finally { $("sendChatBtn").disabled = false; $("sendChatBtn").textContent = "Send edit"; }
});
$("chatInput").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("sendChatBtn").click(); } });
$("deployBtn").addEventListener("click", async () => {
  if (!currentJobId) return showError("Generate a project before publishing.");
  const accessKey = $("deployAccessKey").value;
  if (!accessKey) { $("deployStatus").textContent = "Enter the server publish access key."; $("deployStatus").className = "deploy-error"; return; }
  $("deployBtn").disabled = true; $("deployBtn").textContent = "Publishing…";
  $("deployStatus").textContent = "Publishing project…"; $("deployStatus").className = "muted"; clearError();
  try {
    const result = await api(`/api/jobs/${encodeURIComponent(currentJobId)}/deploy`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-deployment-access-key": accessKey },
      body: JSON.stringify({ customDomain: $("customDomain").value.trim() })
    });
    $("deployStatus").textContent = result.deployment?.url ? `Published: ${result.deployment.url}` : "Cloudflare accepted the deployment.";
    $("deployStatus").className = "deploy-success";
    if (result.deployment?.url) {
      const a = document.createElement("a"); a.href = result.deployment.url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = " Open app"; $("deployStatus").appendChild(a);
    }
    if (result.deployment?.domainError) $("deployStatus").textContent += ` Custom domain setup needs attention: ${result.deployment.domainError}`;
    await loadJob(currentJobId);
  } catch (err) { $("deployStatus").textContent = err.message; $("deployStatus").className = "deploy-error"; }
  finally { $("deployBtn").disabled = lastJobStatus !== "completed"; $("deployBtn").textContent = "Publish app"; }
});
$("downloadBtn").addEventListener("click", () => { if (currentJobId) window.location.href = `/api/jobs/${encodeURIComponent(currentJobId)}/export`; });
$("refreshBtn").addEventListener("click", () => currentJobId && loadJob(currentJobId).catch(e => showError(e.message)));
$("reloadJobs").addEventListener("click", loadJobs);
document.querySelectorAll(".example").forEach(btn => btn.addEventListener("click", () => { $("prompt").value = btn.dataset.prompt; $("prompt").focus(); }));
try { $("backendUrl").value = sessionStorage.getItem("forgepilot-backend-url") || ""; } catch {}
$("backendUrl").addEventListener("change", () => { saveBackendUrl(); checkHealth(); loadJobs(); });
loadProviders(); checkHealth(); loadJobs(); setInterval(checkHealth, 30000);
