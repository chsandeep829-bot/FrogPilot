require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const PROJECTS_DIR = path.join(__dirname, "generated-projects");

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));

fs.mkdirSync(PROJECTS_DIR, { recursive: true });

const jobs = new Map();

function safeProjectName(value) {
  const clean = String(value || "my-app")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return clean || "my-app";
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(unfenced); } catch (_) {}
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(unfenced.slice(first, last + 1)); } catch (_) {}
  }
  throw new Error("The AI response did not contain valid JSON. Try a clearer prompt or another model.");
}

function normalizeProviders(input) {
  const list = Array.isArray(input) ? input : [];
  const cleaned = list.slice(0, 12).map((p, i) => ({
    name: String(p?.name || `Provider ${i + 1}`).trim().slice(0, 60),
    baseUrl: String(p?.baseUrl || "").trim().replace(/\\/+$/, ""),
    apiKey: String(p?.apiKey || "").trim(),
    model: String(p?.model || "").trim()
  })).filter(p => {
    try { return /^https?:$/.test(new URL(p.baseUrl).protocol) && p.apiKey && p.model; }
    catch { return false; }
  });
  if (!cleaned.length && process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL &&
      process.env.AI_API_KEY !== "replace-with-your-own-key") {
    cleaned.push({
      name: "Server default",
      baseUrl: process.env.AI_BASE_URL.replace(/\\/+$/, ""),
      apiKey: process.env.AI_API_KEY,
      model: process.env.AI_MODEL
    });
  }
  return cleaned;
}

function isFallbackWorthy(status, message) {
  return [401, 402, 403, 408, 413, 429, 500, 502, 503, 504].includes(Number(status)) ||
    /quota|credit|rate.?limit|capacity|temporar|overloaded|billing|insufficient|exhaust/i.test(String(message || ""));
}

async function callAI(systemPrompt, userPrompt, providerInput) {
  const providers = normalizeProviders(providerInput);
  if (!providers.length) {
    const err = new Error("Add at least one AI provider with its name, OpenAI-compatible API base URL, API key, and model ID. Keys are used for this request and are not saved to project files.");
    err.status = 400;
    throw err;
  }
  const failures = [];
  for (const provider of providers) {
    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: provider.model,
          temperature: 0.2,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        }),
        signal: AbortSignal.timeout(120000)
      });
      const raw = await response.text();
      let payload;
      try { payload = JSON.parse(raw); } catch (_) { payload = { raw }; }
      if (!response.ok) {
        const message = payload?.error?.message || payload?.message || `Provider returned HTTP ${response.status}`;
        failures.push(`${provider.name}: ${message.slice(0, 220)}`);
        if (isFallbackWorthy(response.status, message)) continue;
        continue;
      }
      const content = payload?.choices?.[0]?.message?.content;
      if (!content) {
        failures.push(`${provider.name}: provider returned no message content`);
        continue;
      }
      return { content, providerName: provider.name };
    } catch (err) {
      failures.push(`${provider.name}: ${String(err.message || "request failed").slice(0, 180)}`);
    }
  }
  const err = new Error("All configured AI providers failed. Check provider keys, model IDs, and credits. Attempts: " + failures.join(" | "));
  err.status = 502;
  throw err;
}

const PROJECT_SYSTEM = `You are a careful software project generator. Return ONLY valid JSON, no markdown fences, with this exact shape:
{"name":"short-project-name","summary":"short summary","files":[{"path":"index.html","content":"full file content"}]}
Create a small, runnable web project using only HTML, CSS, and vanilla JavaScript unless the user explicitly asks for a framework. Include index.html and any required CSS/JS files. Keep paths relative and safe. Do not include secrets, API keys, shell scripts, or instructions to exfiltrate data. Do not claim the project was executed or tested. Limit output to at most 8 files and keep each file reasonably small.`;

function getCloudflareConfig() {
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || "",
    apiToken: process.env.CLOUDFLARE_API_TOKEN || "",
    projectName: process.env.CLOUDFLARE_PAGES_PROJECT_NAME || "",
    accessKey: process.env.DEPLOYMENT_ACCESS_KEY || ""
  };
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8", ".xml": "application/xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
    ".woff": "font/woff", ".woff2": "font/woff2", ".pdf": "application/pdf"
  })[ext] || "application/octet-stream";
}

async function cloudflareJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch (_) { data = { raw }; }
  if (!response.ok || data.success === false) {
    const detail = (data.errors || []).map(e => e.message).filter(Boolean).join("; ");
    const err = new Error(detail || data.message || `Cloudflare API returned HTTP ${response.status}`);
    err.status = response.status || 502;
    throw err;
  }
  return data;
}

async function deployFilesToCloudflarePages(files, appName, customDomain = "") {
  const config = getCloudflareConfig();
  if (!config.accountId || !config.apiToken || !config.projectName) {
    const err = new Error("Cloudflare Pages is not configured. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_PAGES_PROJECT_NAME in the server environment.");
    err.status = 503;
    throw err;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.projectName)) {
    const err = new Error("CLOUDFLARE_PAGES_PROJECT_NAME must be a lowercase Pages project slug (letters, numbers, and hyphens).");
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(files) || files.length === 0 || !files.some(file => file.path === "index.html")) {
    const err = new Error("The generated project must contain index.html and at least one file.");
    err.status = 400;
    throw err;
  }
  if (files.length > 20000) {
    const err = new Error("Cloudflare Pages supports up to 20,000 files per deployment.");
    err.status = 400;
    throw err;
  }

  const deploymentProjectName = safeProjectName(`${config.projectName}-${appName}`).slice(0, 63);
  const manifest = {};
  const byHash = new Map();
  for (const file of files) {
    const rel = String(file.path || "").replace(/\\/g, "/");
    if (!rel || rel.startsWith("/") || rel.split("/").some(part => !part || part === "." || part === "..")) continue;
    const content = Buffer.from(String(file.content ?? ""), "utf8");
    // Pages Direct Upload expects a 32-character hexadecimal content hash.
    const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 32);
    const remotePath = `/${rel}`;
    manifest[remotePath] = hash;
    byHash.set(hash, { content, contentType: mimeType(rel) });
  }
  if (!Object.keys(manifest).length || !manifest["/index.html"]) {
    const err = new Error("No valid files were found to deploy.");
    err.status = 400;
    throw err;
  }

  const base = "https://api.cloudflare.com/client/v4";
  const authHeaders = { Authorization: `Bearer ${config.apiToken}` };
  const projectPath = `/accounts/${encodeURIComponent(config.accountId)}/pages/projects/${encodeURIComponent(deploymentProjectName)}`;

  // Each app gets its own Pages project so publishing a new app does not overwrite another app.
  try {
    await cloudflareJson(`${base}${projectPath}`, { headers: authHeaders });
  } catch (err) {
    if (Number(err.status) !== 404) throw err;
    await cloudflareJson(`${base}/accounts/${encodeURIComponent(config.accountId)}/pages/projects`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ name: deploymentProjectName, production_branch: "main" })
    });
  }

  // Get a short-lived JWT for uploading Pages assets.
  const tokenData = await cloudflareJson(`${base}${projectPath}/upload-token`, { headers: authHeaders });
  const uploadToken = tokenData?.result?.jwt;
  if (!uploadToken) throw new Error("Cloudflare did not return an upload token. Check that the Pages project exists and the API token has Pages Write permission.");

  // Upload in small batches. Pages' asset endpoint accepts base64-encoded values.
  const entries = [...byHash.entries()];
  const batchSize = 50;
  for (let i = 0; i < entries.length; i += batchSize) {
    const body = entries.slice(i, i + batchSize).map(([hash, asset]) => ({
      base64: true,
      key: hash,
      value: asset.content.toString("base64"),
      metadata: { contentType: asset.contentType }
    }));
    await cloudflareJson(`${base}/pages/assets/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${uploadToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  // Cloudflare requires manifest as a JSON-encoded multipart form field for direct uploads.
  const form = new FormData();
  form.set("manifest", JSON.stringify(manifest));
  form.set("commit_message", "Deploy from ForgePilot");
  form.set("commit_dirty", "false");
  const deploymentData = await cloudflareJson(`${base}${projectPath}/deployments`, {
    method: "POST",
    headers: authHeaders,
    body: form
  });
  const deployment = deploymentData?.result || {};
  const result = {
    id: deployment.id || null,
    url: deployment.url || (Array.isArray(deployment.aliases) ? deployment.aliases[0] : null) || null,
    projectName: deployment.project_name || deploymentProjectName,
    status: deployment.latest_stage?.status || "queued",
    customDomain: null,
    domainError: null
  };
  const domain = String(customDomain || "").trim().toLowerCase().replace(/^https?:\\/\\//, "").replace(/\\/$/, "");
  if (domain) {
    if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$/.test(domain)) {
      result.domainError = "Enter a valid domain name without a path, such as app.example.com.";
    } else {
      try {
        await cloudflareJson(`${base}${projectPath}/domains`, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ name: domain })
        });
        result.customDomain = domain;
      } catch (err) {
        result.domainError = err.message || "Could not attach the custom domain. Confirm the domain is active in this Cloudflare account and DNS is configured.";
      }
    }
  }
  if (!result.url && result.customDomain) result.url = `https://${result.customDomain}`;
  return result;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ai-app-builder-agent",
    time: new Date().toISOString(),
    aiConfigured: Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL && process.env.AI_API_KEY !== "replace-with-your-own-key"),
    cloudflareConfigured: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_PAGES_PROJECT_NAME && process.env.DEPLOYMENT_ACCESS_KEY)
  });
});

app.get("/api/jobs", (_req, res) => {
  const list = [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
  res.json({ jobs: list.map(({ id, name, prompt, status, createdAt, finishedAt, error, files }) => ({
    id, name, prompt, status, createdAt, finishedAt, error, fileCount: files?.length || 0
  })) });
});

app.post("/api/generate", async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  const requestedName = safeProjectName(req.body?.name || "my-app");
  const providers = normalizeProviders(req.body?.providers);
  if (prompt.length < 8) return res.status(400).json({ error: "Please describe the app in at least 8 characters." });
  if (prompt.length > 6000) return res.status(400).json({ error: "Prompt is too long (maximum 6000 characters)." });

  const id = crypto.randomUUID();
  const job = {
    id, name: requestedName, prompt, status: "running", chat: [],
    createdAt: new Date().toISOString(), finishedAt: null, error: null, files: []
  };
  jobs.set(id, job);
  res.status(202).json({ id, status: "running" });

  (async () => {
    try {
      const responseText = await callAI(PROJECT_SYSTEM, `Project name: ${requestedName}\nUser requirements:\n${prompt}`);
      const parsed = extractJson(responseText);
      if (!Array.isArray(parsed.files) || parsed.files.length === 0) throw new Error("AI did not return a file list.");

      const cleanFiles = [];
      for (const item of parsed.files.slice(0, 8)) {
        const rel = String(item.path || "").replace(/\\/g, "/");
        if (!rel || rel.startsWith("/") || rel.split("/").some(part => part === "..") || !/^[a-zA-Z0-9._/-]+$/.test(rel)) {
          continue;
        }
        if (typeof item.content !== "string") continue;
        cleanFiles.push({ path: rel, content: item.content });
      }
      if (!cleanFiles.some(f => f.path === "index.html")) {
        throw new Error("Generated project is missing index.html. Try generating again.");
      }

      const folder = path.join(PROJECTS_DIR, id);
      fs.mkdirSync(folder, { recursive: true });
      for (const file of cleanFiles) {
        const target = path.join(folder, file.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.content, "utf8");
      }
      job.name = safeProjectName(parsed.name || requestedName);
      job.summary = String(parsed.summary || "Generated project");
      job.files = cleanFiles;
      job.status = "completed";
      job.finishedAt = new Date().toISOString();
    } catch (err) {
      job.status = "failed";
      job.error = err.message || "Generation failed";
      job.finishedAt = new Date().toISOString();
    }
  })();
});

app.post("/api/jobs/:id/chat", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "completed") return res.status(404).json({ error: "Completed project not found." });
  const message = String(req.body?.message || "").trim();
  if (message.length < 2 || message.length > 4000) return res.status(400).json({ error: "Enter an edit request between 2 and 4000 characters." });
  const providers = normalizeProviders(req.body?.providers);
  const system = `You are editing an existing web app project. Return ONLY valid JSON with shape:
{"name":"project-name","summary":"short summary","assistantMessage":"brief explanation of edits","files":[{"path":"index.html","content":"full file content"}]}
Preserve existing functionality unless asked to change it. Return the complete updated contents of every file needed. Use only HTML/CSS/vanilla JS unless the project already uses another framework. Maximum 12 files. No secrets or API keys. Keep paths relative and safe.`;
  try {
    const context = JSON.stringify({ name: job.name, summary: job.summary, files: job.files });
    const result = await callAI(system, `Current project files:\\n${context}\\n\\nUser edit request:\\n${message}`, providers);
    const parsed = extractJson(result.content);
    if (!Array.isArray(parsed.files) || !parsed.files.length) throw new Error("AI did not return updated project files.");
    const cleanFiles = [];
    for (const item of parsed.files.slice(0, 12)) {
      const rel = String(item.path || "").replace(/\\\\/g, "/");
      if (!rel || rel.startsWith("/") || rel.split("/").some(part => !part || part === "." || part === "..") || !/^[a-zA-Z0-9._/-]+$/.test(rel)) continue;
      if (typeof item.content === "string") cleanFiles.push({ path: rel, content: item.content });
    }
    if (!cleanFiles.some(f => f.path === "index.html")) throw new Error("Updated project is missing index.html.");
    const folder = path.join(PROJECTS_DIR, job.id);
    for (const file of cleanFiles) {
      const target = path.join(folder, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, "utf8");
    }
    job.files = cleanFiles;
    job.summary = String(parsed.summary || job.summary || "Updated project");
    job.chat = [...(job.chat || []), { role: "user", content: message, at: new Date().toISOString() },
      { role: "assistant", content: String(parsed.assistantMessage || "Updated the project files."), at: new Date().toISOString(), provider: result.providerName }].slice(-40);
    job.updatedAt = new Date().toISOString();
    res.json({ success: true, assistantMessage: String(parsed.assistantMessage || "Updated the project files."), provider: result.providerName, files: job.files, summary: job.summary, chat: job.chat });
  } catch (err) {
    res.status(Number(err.status) >= 400 && Number(err.status) < 600 ? Number(err.status) : 502).json({ error: err.message || "Could not edit the project." });
  }
});

app.post("/api/jobs/:id/deploy", async (req, res) => {
  const config = getCloudflareConfig();
  if (!config.accessKey) {
    return res.status(503).json({ error: "Deployment is disabled until DEPLOYMENT_ACCESS_KEY is set on the server." });
  }
  const providedKey = String(req.get("x-deployment-access-key") || "");
  const expected = Buffer.from(config.accessKey);
  const provided = Buffer.from(providedKey);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return res.status(401).json({ error: "Invalid deployment access key." });
  }
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "completed") {
    return res.status(404).json({ error: "Completed project not found. Generate the project before deploying." });
  }
  try {
    const deployment = await deployFilesToCloudflarePages(job.files, job.name, req.body?.customDomain || "");
    job.deployment = { ...deployment, deployedAt: new Date().toISOString() };
    return res.json({ success: true, deployment });
  } catch (err) {
    const status = Number(err.status) >= 400 && Number(err.status) < 600 ? Number(err.status) : 502;
    return res.status(status).json({ error: err.message || "Cloudflare Pages deployment failed." });
  }
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found. Jobs are kept in memory until the server restarts." });
  res.json({
    id: job.id, name: job.name, summary: job.summary, prompt: job.prompt,
    status: job.status, createdAt: job.createdAt, finishedAt: job.finishedAt,
    error: job.error, providerName: job.providerName || null, chat: job.chat || [], deployment: job.deployment || null, files: job.files.map(f => ({ path: f.path, content: f.content }))
  });
});

app.get("/api/jobs/:id/files/:filePath(*)", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "completed") return res.status(404).json({ error: "Project file not available." });
  const requested = String(req.params.filePath || "").replace(/\\/g, "/");
  const file = job.files.find(f => f.path === requested);
  if (!file) return res.status(404).json({ error: "File not found." });
  res.type("text/plain").send(file.content);
});

app.get("/api/jobs/:id/export", async (req, res) => {
  if (String(process.env.ENABLE_PROJECT_EXPORT || "true").toLowerCase() !== "true") {
    return res.status(403).json({ error: "Project export is disabled." });
  }
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "completed") return res.status(404).json({ error: "Completed project not found." });

  // Minimal ZIP writer avoids extra dependencies. Supports stored (uncompressed) files.
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();
  const crc32 = (buf) => {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const locals = [], centrals = [];
  let offset = 0;
  for (const file of job.files) {
    const nameBuf = Buffer.from(file.path, "utf8");
    const data = Buffer.from(file.content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(job.files.length, 8);
  end.writeUInt16LE(job.files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  const zip = Buffer.concat([...locals, ...centrals, end]);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${job.name}.zip"`);
  res.send(zip);
});

app.get("*", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`AI App Builder Agent running on http://localhost:${PORT}`);
});
