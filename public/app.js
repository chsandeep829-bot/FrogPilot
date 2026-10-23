const $ = (id) => document.getElementById(id);
let currentJobId = null;
let pollTimer = null;
let lastJobStatus = null;

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: HTTP ${res.status}`);
  return data;
}
function fmtDate(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleString(); } catch { return value; }
}
function setBadge(text, type = "") {
  $("jobBadge").textContent = text;
  $("jobBadge").className = `badge ${type}`;
}
async function checkHealth() {
  try {
    const data = await api("/api/health");
    const aiStatus = data.aiConfigured ? "AI configured" : "AI needs setup";
    const deployStatus = data.cloudflareConfigured ? "Cloudflare ready" : "Cloudflare setup needed";
    $("serverStatus").textContent = `Server online · ${aiStatus} · ${deployStatus}`;
    document.querySelector(".dot").style.background = data.aiConfigured ? "#4adea1" : "#fbbf24";
  } catch {
    $("serverStatus").textContent = "Server unavailable";
    document.querySelector(".dot").style.background = "#fb7185";
  }
}
function showError(message) {
  $("errorBox").textContent = message;
  $("errorBox").classList.remove("hidden");
}
function clearError() {
  $("errorBox").textContent = "";
  $("errorBox").classList.add("hidden");
}
function renderFiles(files) {
  $("fileList").innerHTML = "";
  if (!files?.length) {
    $("fileList").innerHTML = '<p class="muted">No files yet.</p>';
    return;
  }
  for (const file of files) {
    const el = document.createElement("span");
    el.className = "file-pill";
    el.textContent = file.path;
    $("fileList").appendChild(el);
  }
  const html = files.find(f => f.path === "index.html");
  if (html) $("preview").srcdoc = html.content;
}
async function loadJob(id) {
  const job = await api(`/api/jobs/${encodeURIComponent(id)}`);
  $("resultSection").classList.remove("hidden");
  $("resultTitle").textContent = job.name || "Project result";
  $("resultSubtitle").textContent = `Created ${fmtDate(job.createdAt)} · Finished ${fmtDate(job.finishedAt)}`;
  $("summary").textContent = job.summary || "";
  renderFiles(job.files);
  $("downloadBtn").disabled = job.status !== "completed";
  lastJobStatus = job.status;
  $("deployBtn").disabled = job.status !== "completed";
  if (job.deployment?.url) {
    $("deployStatus").textContent = `Deployed: ${job.deployment.url}`;
    $("deployStatus").className = "deploy-success";
  }
  if (job.status === "completed") setBadge("Completed", "good");
  else if (job.status === "failed") setBadge("Failed", "bad");
  else setBadge("Generating…");
  if (job.error) showError(job.error); else clearError();
  if (job.status !== "running" && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    $("generateBtn").disabled = false;
    $("generateBtn").innerHTML = "<span>✦</span> Generate project";
  }
  await loadJobs();
}
async function loadJobs() {
  try {
    const data = await api("/api/jobs");
    $("jobsList").innerHTML = "";
    if (!data.jobs.length) {
      $("jobsList").innerHTML = '<p class="muted">No projects generated in this server session yet.</p>';
      return;
    }
    for (const job of data.jobs) {
      const row = document.createElement("div");
      row.className = "job";
      const left = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = job.name;
      const meta = document.createElement("small");
      meta.textContent = `${fmtDate(job.createdAt)} · ${job.fileCount || 0} files`;
      left.append(title, meta);
      const right = document.createElement("div");
      right.className = "job-state";
      right.textContent = job.status;
      row.append(left, right);
      row.style.cursor = "pointer";
      row.title = "Open this job";
      row.addEventListener("click", () => { currentJobId = job.id; loadJob(job.id).catch(e => showError(e.message)); });
      $("jobsList").appendChild(row);
    }
  } catch (err) {
    $("jobsList").innerHTML = `<p class="muted">${err.message}</p>`;
  }
}
$("generateBtn").addEventListener("click", async () => {
  const prompt = $("prompt").value.trim();
  const name = $("projectName").value.trim() || "my-app";
  clearError();
  if (prompt.length < 8) return showError("Please describe your app in at least 8 characters.");
  $("generateBtn").disabled = true;
  $("generateBtn").textContent = "Generating…";
  $("resultSection").classList.remove("hidden");
  $("resultTitle").textContent = name;
  $("resultSubtitle").textContent = "Waiting for the AI provider…";
  $("summary").textContent = "";
  renderFiles([]);
  setBadge("Starting");
  $("downloadBtn").disabled = true;
  try {
    const result = await api("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, name })
    });
    currentJobId = result.id;
    await loadJob(currentJobId);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => loadJob(currentJobId).catch(e => showError(e.message)), 2500);
  } catch (err) {
    showError(err.message);
    setBadge("Failed", "bad");
    $("generateBtn").disabled = false;
    $("generateBtn").innerHTML = "<span>✦</span> Generate project";
  }
});
$("deployBtn").addEventListener("click", async () => {
  if (!currentJobId) return showError("Generate a project before deploying.");
  const accessKey = $("deployAccessKey").value;
  if (!accessKey) {
    $("deployStatus").textContent = "Enter the deployment access key configured on the server.";
    $("deployStatus").className = "deploy-error";
    return;
  }
  $("deployBtn").disabled = true;
  $("deployBtn").textContent = "Deploying…";
  $("deployStatus").textContent = "Uploading files to Cloudflare Pages…";
  $("deployStatus").className = "muted";
  clearError();
  try {
    const result = await api(`/api/jobs/${encodeURIComponent(currentJobId)}/deploy`, {
      method: "POST",
      headers: { "x-deployment-access-key": accessKey }
    });
    if (result.deployment?.url) {
      $("deployStatus").textContent = `Deployment created: ${result.deployment.url}`;
      $("deployStatus").className = "deploy-success";
      const link = document.createElement("a");
      link.href = result.deployment.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = " Open deployed app";
      $("deployStatus").appendChild(link);
    } else {
      $("deployStatus").textContent = `Cloudflare accepted the deployment request (status: ${result.deployment?.status || "queued"}), but did not return a URL yet. Check Cloudflare Pages deployments.`;
      $("deployStatus").className = "deploy-success";
    }
  } catch (err) {
    $("deployStatus").textContent = err.message;
    $("deployStatus").className = "deploy-error";
  } finally {
    $("deployBtn").disabled = lastJobStatus !== "completed";
    $("deployBtn").textContent = "Deploy to Cloudflare Pages";
  }
});

$("downloadBtn").addEventListener("click", () => {
  if (currentJobId) window.location.href = `/api/jobs/${encodeURIComponent(currentJobId)}/export`;
});
$("refreshBtn").addEventListener("click", () => currentJobId && loadJob(currentJobId).catch(e => showError(e.message)));
$("reloadJobs").addEventListener("click", loadJobs);
document.querySelectorAll(".example").forEach(btn => btn.addEventListener("click", () => {
  $("prompt").value = btn.dataset.prompt;
  $("prompt").focus();
}));
checkHealth();
loadJobs();
setInterval(checkHealth, 30000);
