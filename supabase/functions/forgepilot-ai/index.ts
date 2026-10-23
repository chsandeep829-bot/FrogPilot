import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
function fromBase64(s: string) {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function cryptoKey() {
  const secret = Deno.env.get("PROVIDER_VAULT_ENCRYPTION_KEY") || "";
  if (secret.length < 32) throw new Error("Set PROVIDER_VAULT_ENCRYPTION_KEY to a random secret of at least 32 characters.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
}
async function decrypt(value: string) {
  const bytes = fromBase64(value), iv = bytes.slice(0, 12), cipher = bytes.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await cryptoKey(), cipher);
  return JSON.parse(new TextDecoder().decode(plain));
}
function parseJson(content: string) {
  const cleaned = content.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI did not return a JSON project.");
  return JSON.parse(cleaned.slice(start, end + 1));
}
function validateFiles(input: any[]) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 12) throw new Error("AI returned an invalid file list.");
  const files = input.map((f: any) => {
    const path = String(f.path || "").replace(/^\/+/, "");
    if (!path || path.split("/").some((part: string) => !part || part === "." || part === "..") || path.includes("\\") || path.length > 180) throw new Error("AI returned an unsafe file path.");
    return { path, content: String(f.content || "") };
  });
  if (!files.some((f: any) => f.path === "index.html")) throw new Error("AI project must include index.html.");
  if (files.some((f: any) => f.content.length > 180000)) throw new Error("An AI-generated file exceeded the size limit.");
  return files;
}
async function callProvider(providers: any[], systemPrompt: string, userPrompt: string) {
  const failures: string[] = [];
  for (const p of providers) {
    try {
      const baseUrl = String(p.baseUrl || "").replace(/\/+$/, "");
      if (!/^https:\/\//i.test(baseUrl)) { failures.push(String(p.name)+": provider URL must use HTTPS"); continue; }
      const response = await fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + p.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ model: p.model, temperature: 0.2, messages: [{role:"system",content:systemPrompt},{role:"user",content:userPrompt}] }),
        signal: AbortSignal.timeout(115000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { failures.push(String(p.name)+": "+String(payload?.error?.message||payload?.message||("HTTP "+response.status)).slice(0,180)); continue; }
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) { failures.push(String(p.name)+": no response content"); continue; }
      return { content, provider: String(p.name || "AI provider") };
    } catch (e) { failures.push(String(p.name)+": "+String(e instanceof Error?e.message:e).slice(0,160)); }
  }
  throw new Error("All saved AI providers failed. Check the saved keys, model IDs, provider credits and endpoints. "+failures.join(" | "));
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "Sign in first." }, 401);
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !anon || !service) return json({ error: "Supabase Edge Function secrets are not configured." }, 500);
    const authClient = createClient(url, anon, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid or expired session." }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: vault, error: vaultError } = await admin.from("forgepilot_provider_vault").select("encrypted_payload").eq("user_id", user.id).maybeSingle();
    if (vaultError) throw vaultError;
    if (!vault) return json({ error: "No saved AI provider keys. Add a provider in Settings and tap Save AI keys to encrypted vault." }, 400);
    const providers = await decrypt(vault.encrypted_payload);
    if (!Array.isArray(providers) || !providers.length) return json({ error: "Your encrypted provider vault is empty." }, 400);
    const body = await req.json();
    const action = String(body.action || "");
    const name = String(body.name || "my-app").replace(/[^a-z0-9-]/gi, "-").slice(0, 48) || "my-app";
    const projectSystem = `You are a careful software project generator. Return ONLY valid JSON, no markdown fences, with this shape: {"name":"short-project-name","summary":"short summary","assistantMessage":"brief message","files":[{"path":"index.html","content":"full file content"}]}. Create a runnable responsive web project using HTML, CSS and vanilla JavaScript unless asked otherwise. Include index.html. Use relative safe paths. Never include secrets, API keys, server-side credentials or data-exfiltration code. Maximum 12 files, each reasonably small. Do not claim the code was executed or tested.`;
    let systemPrompt = projectSystem, userPrompt = "";
    if (action === "generate") {
      const prompt = String(body.prompt || "").trim();
      if (prompt.length < 8 || prompt.length > 6000) return json({ error: "Describe the app in 8 to 6000 characters." }, 400);
      userPrompt = "Project name: "+name+"\nUser requirements:\n"+prompt;
    } else if (action === "edit") {
      const message = String(body.message || "").trim();
      if (message.length < 2 || message.length > 4000) return json({ error: "Describe the change in 2 to 4000 characters." }, 400);
      const files = validateFiles(body.files);
      systemPrompt = `You are editing an existing web app. Return ONLY valid JSON: {"name":"project-name","summary":"short summary","assistantMessage":"brief explanation","files":[{"path":"index.html","content":"full updated file content"}]}. Preserve existing features unless asked otherwise. Return the complete contents of all required files. Use safe relative paths, no secrets, maximum 12 files. Do not claim tests were run.`;
      userPrompt = "Project name: "+name+"\nCurrent project files:\n"+JSON.stringify(files)+"\n\nRequested edit:\n"+message;
    } else return json({ error: "Unknown action." }, 400);
    const result = await callProvider(providers, systemPrompt, userPrompt);
    const parsed = parseJson(result.content);
    const files = validateFiles(parsed.files);
    return json({ success: true, name: String(parsed.name || name).slice(0,80), summary: String(parsed.summary || "").slice(0,2000), assistantMessage: String(parsed.assistantMessage || (action==="generate"?"Created your project.":"Updated your project.")).slice(0,2000), files, provider: result.provider });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected serverless AI error." }, 502);
  }
});
