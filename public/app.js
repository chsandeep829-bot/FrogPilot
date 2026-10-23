const $ = (id) => document.getElementById(id);
let currentJobId = null, pollTimer = null, lastJobStatus = null;
let providerCounter = 0;\n
let supabaseClient = null, signedInUser = null;
const cloudSavedHashes = new Map();
function getSupabaseConfig() {
  return { url: $("supabaseUrl")?.value.trim().replace(/\/$/, ""), key: $("supabaseAnonKey")?.value.trim() };
}
function setAccountStatus(message, error=false) {
  const el=$("accountStatus"); if(el){el.textContent=message;el.className=error?"deploy-error":"muted";}
}
function authHeaders() {
  const sessionState = supabaseClient ? null : null;
  return sessionState;
}
async function ensureSupabase() {
  const cfg=getSupabaseConfig();
  if(!window.supabase?.createClient) throw new Error("Supabase client library did not load. Check your connection.");
  if(!cfg.url || !cfg.key) throw new Error("Enter the Supabase project URL and public anon/publishable key first.");
  if(!supabaseClient || supabaseClient.supabaseUrl!==cfg.url) {
    supabaseClient=window.supabase.createClient(cfg.url,cfg.key);
    const {data}=await supabaseClient.auth.getSession();
    signedInUser=data.session?.user||null;
  }
  return supabaseClient;
}
function updateAccountControls() {
  const signed=Boolean(signedInUser);
  ["signOutBtn","saveCloudProfileBtn","saveVaultBtn","loadVaultBtn"].forEach(id=>{if($(id))$(id).disabled=!signed;});
  if(signedInUser){$("accountEmail").value=signedInUser.email||"";$("accountName").value=signedInUser.user_metadata?.full_name||"";}
}
async function saveCloudProfile() {
  const client=await ensureSupabase(); if(!signedInUser) throw new Error("Sign in first.");
  const payload={id:signedInUser.id,email:signedInUser.email,full_name:$("accountName").value.trim(),updated_at:new Date().toISOString()};
  const {error}=await client.from("forgepilot_profiles").upsert(payload,{onConflict:"id"});
  if(error) throw error;
  const {error:metaError}=await client.auth.updateUser({data:{full_name:payload.full_name}});
  if(metaError) throw metaError;
}
async function loadCloudProjects() {
  const box=$("cloudProjects"); if(!box) return;
  if(!supabaseClient || !signedInUser){box.textContent="Sign in to sync your projects.";return;}
  const {data,error}=await supabaseClient.from("forgepilot_projects").select("id,backend_job_id,name,summary,files,chat,created_at,updated_at").order("updated_at",{ascending:false}).limit(50);
  if(error){box.textContent="Cloud project list unavailable: "+error.message;return;}
  box.replaceChildren();
  if(!data?.length){const p=document.createElement("p");p.className="muted";p.textContent="No cloud projects saved yet. Generate an app to sync it here.";box.appendChild(p);return;}
  data.forEach(project=>{
    const row=document.createElement("div");row.className="job";
    const left=document.createElement("div"),title=document.createElement("strong"),meta=document.createElement("small"),open=document.createElement("button");
    title.textContent=project.name||"Untitled project";meta.textContent=fmtDate(project.updated_at)+" · "+(project.files?.length||0)+" files";
    left.append(title,meta);open.type="button";open.className="secondary small";open.textContent="Open";
    open.addEventListener("click",()=>openCloudProject(project));row.append(left,open);box.appendChild(row);
  });
}
function openCloudProject(project) {
  currentJobId=project.backend_job_id||("cloud-"+project.id);
  $("resultSection").classList.remove("hidden");$("resultTitle").textContent=project.name||"Saved project";$("resultSubtitle").textContent="Loaded from your cloud account · "+fmtDate(project.updated_at);
  $("summary").textContent=project.summary||"";renderFiles(project.files||[]);renderChat(project.chat||[]);
  lastJobStatus="completed";$("downloadBtn").disabled=true;$("deployBtn").disabled=true;setBadge("Cloud saved","good");
  $("resultSection").scrollIntoView({behavior:"smooth",block:"start"});
}
async function persistCloudProject(job) {
  if(!supabaseClient || !signedInUser || job?.status!=="completed" || !job.files?.length) return;
  const signature=JSON.stringify({name:job.name,summary:job.summary,files:job.files,chat:job.chat||[]});
  if(cloudSavedHashes.get(job.id)===signature) return;
  cloudSavedHashes.set(job.id,signature);
  const payload={user_id:signedInUser.id,backend_job_id:job.id,name:job.name||"Untitled project",summary:job.summary||"",files:job.files,chat:job.chat||[],updated_at:new Date().toISOString()};
  const {error}=await supabaseClient.from("forgepilot_projects").upsert(payload,{onConflict:"user_id,backend_job_id"});
  if(error){cloudSavedHashes.delete(job.id);setAccountStatus("Project is ready, but cloud sync failed: "+error.message,true);return;}
  await loadCloudProjects();
}
async function vaultRequest(action, providers) {
  const client=await ensureSupabase();const {data}=await client.auth.getSession();
  if(!data.session?.access_token) throw new Error("Sign in to use the encrypted API-key vault.");
  const cfg=getSupabaseConfig();
  const res=await fetch(cfg.url+"/functions/v1/provider-vault",{method:"POST",headers:{"Content-Type":"application/json","apikey":cfg.key,"Authorization":"Bearer "+data.session.access_token},body:JSON.stringify({action,providers})});
  const result=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(result.error||"Encrypted key vault request failed (HTTP "+res.status+"). Deploy the provider-vault Edge Function and set its secrets first.");
  return result;
}
async function initializeAccount() {
  try {
    const client=await ensureSupabase();
    const {data}=await client.auth.getSession();signedInUser=data.session?.user||null;
    client.auth.onAuthStateChange((_event,session)=>{signedInUser=session?.user||null;updateAccountControls();if(signedInUser){loadCloudProjects();}else{$("cloudProjects").textContent="Sign in to sync your projects."; }});
    updateAccountControls();
    if(signedInUser){setAccountStatus("Signed in as "+(signedInUser.email||"user"));await loadCloudProjects();}
  } catch(e) {setAccountStatus(e.message); }
}
async function accountAction(action) {
  try {
    const client=await ensureSupabase(),email=$("accountEmail").value.trim(),password=$("accountPassword").value;
    if(action==="signup"){
      if($("accountName").value.trim().length<2) throw new Error("Enter your name before creating an account.");
      const {data,error}=await client.auth.signUp({email,password,options:{data:{full_name:$("accountName").value.trim()}}});if(error)throw error;
      signedInUser=data.user;
      if(data.session){await saveCloudProfile();setAccountStatus("Account created and signed in.");}
      else setAccountStatus("Account created. Check your email to confirm it, then sign in.");
    } else if(action==="signin"){
      const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw error;
      signedInUser=data.user;await saveCloudProfile();setAccountStatus("Signed in as "+email);
    } else if(action==="signout"){
      const {error}=await client.auth.signOut();if(error)throw error;signedInUser=null;setAccountStatus("Signed out.");
    }
    updateAccountControls();if(signedInUser)await loadCloudProjects();
  } catch(e){setAccountStatus(e.message,true);}
}
async function saveVault() {
  try {
    const providers=getProviders();if(!providers.length)throw new Error("Add at least one complete provider first.");
    await vaultRequest("save",providers);setAccountStatus("AI provider keys saved encrypted in your Supabase-backed vault.");
  } catch(e){setAccountStatus(e.message,true);}
}
async function loadVault() {
  try {
    const result=await vaultRequest("load");$("providerList").replaceChildren();
    if(Array.isArray(result.providers)&&result.providers.length)result.providers.forEach(addProvider);else addProvider();
    saveProviders();setAccountStatus(result.providers?.length?"Loaded your saved AI providers.":"No saved providers yet.");
  } catch(e){setAccountStatus(e.message,true);}
}


function getApiBase() {
  const field = $("backendUrl");
  return String(field?.value || "").trim().replace(/\/+$/, "");
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
function loadSettings() {
  try {
    $("backendUrl").value = sessionStorage.getItem("forgepilot-backend-url") || "";
    $("deployAccessKey").value = sessionStorage.getItem("forgepilot-deploy-key-session") || "";
    $("customDomain").value = sessionStorage.getItem("forgepilot-custom-domain-session") || "";
  } catch {}
}
function saveSettings() {
  try {
    sessionStorage.setItem("forgepilot-deploy-key-session", $("deployAccessKey").value);
    sessionStorage.setItem("forgepilot-custom-domain-session", $("customDomain").value.trim());
  } catch {}
  saveBackendUrl();
  saveProviders();
  $("settingsStatus").textContent = "Settings saved for this browser tab session.";
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
loadSettings();
$("backendUrl").addEventListener("change", () => { saveBackendUrl(); checkHealth(); loadJobs(); });
$("deployAccessKey").addEventListener("input", saveSettings);
$("customDomain").addEventListener("input", saveSettings);
$("saveSettingsBtn").addEventListener("click", saveSettings);
loadProviders(); checkHealth(); loadJobs(); setInterval(checkHealth, 30000);\n
$("supabaseUrl").addEventListener("change",()=>{try{sessionStorage.setItem("forgepilot-supabase-url",$("supabaseUrl").value.trim());}catch{};initializeAccount();});
$("supabaseAnonKey").addEventListener("change",()=>{try{sessionStorage.setItem("forgepilot-supabase-anon-key",$("supabaseAnonKey").value.trim());}catch{};supabaseClient=null;initializeAccount();});
$("signUpBtn").addEventListener("click",()=>accountAction("signup"));
$("signInBtn").addEventListener("click",()=>accountAction("signin"));
$("signOutBtn").addEventListener("click",()=>accountAction("signout"));
$("saveCloudProfileBtn").addEventListener("click",async()=>{try{await saveCloudProfile();setAccountStatus("Profile saved to your account.");}catch(e){setAccountStatus(e.message,true);}});
$("saveVaultBtn").addEventListener("click",saveVault);
$("loadVaultBtn").addEventListener("click",loadVault);
try{$("supabaseUrl").value=sessionStorage.getItem("forgepilot-supabase-url")||"";$("supabaseAnonKey").value=sessionStorage.getItem("forgepilot-supabase-anon-key")||"";}catch{}
initializeAccount();



// Three-line navigation: every menu item routes to an existing section or project tab.
const menuToggle = $("menuToggle");
const appDrawer = $("appDrawer");
const drawerBackdrop = $("drawerBackdrop");
function setDrawerOpen(open) {
  appDrawer.classList.toggle("open", open);
  drawerBackdrop.classList.toggle("hidden", !open);
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
  appDrawer.setAttribute("aria-hidden", String(!open));
  document.body.classList.toggle("drawer-open", open);
}
menuToggle.addEventListener("click", () => setDrawerOpen(menuToggle.getAttribute("aria-expanded") !== "true"));
$("closeDrawerBtn").addEventListener("click", () => setDrawerOpen(false));
drawerBackdrop.addEventListener("click", () => setDrawerOpen(false));
document.addEventListener("keydown", event => { if (event.key === "Escape") setDrawerOpen(false); });
document.querySelectorAll("[data-destination]").forEach(item => {
  item.addEventListener("click", () => {
    const destination = item.dataset.destination;
    const tabTarget = item.dataset.tabTarget;
    setDrawerOpen(false);
    if (tabTarget) {
      if ($("resultSection").classList.contains("hidden")) {
        showError("Generate an app first to use Chat, Preview, and Files.");
        $("buildSection").scrollIntoView({ behavior: "smooth", block: "start" });
        $("prompt").focus({ preventScroll: true });
        return;
      }
      switchTab(tabTarget);
    }
    if (destination === "publishSection" && $("resultSection").classList.contains("hidden")) {
      showError("Generate an app first, then use Publish app.");
      $("buildSection").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const target = $(destination);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
