import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
function base64(bytes: Uint8Array) {
  let s = ""; bytes.forEach((b) => s += String.fromCharCode(b)); return btoa(s);
}
function unbase64(s: string) {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function getCryptoKey() {
  const secret = Deno.env.get("PROVIDER_VAULT_ENCRYPTION_KEY") || "";
  if (secret.length < 32) throw new Error("Set PROVIDER_VAULT_ENCRYPTION_KEY to a random secret of at least 32 characters.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encrypt(value: unknown) {
  const key = await getCryptoKey(), iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return base64(new Uint8Array([...iv, ...new Uint8Array(cipher)]));
}
async function decrypt(value: string) {
  const bytes = unbase64(value), iv = bytes.slice(0, 12), cipher = bytes.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await getCryptoKey(), cipher);
  return JSON.parse(new TextDecoder().decode(plain));
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
    if (!url || !anon || !service) return json({ error: "Edge Function secrets are not configured." }, 500);
    const authClient = createClient(url, anon, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid or expired session." }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const body = await req.json();
    if (body.action === "save") {
      if (!Array.isArray(body.providers) || body.providers.length > 10) return json({ error: "Provide at most 10 AI providers." }, 400);
      const providers = body.providers.map((p: any) => ({
        name: String(p.name || "").slice(0, 60), baseUrl: String(p.baseUrl || "").slice(0, 500),
        model: String(p.model || "").slice(0, 200), apiKey: String(p.apiKey || "").slice(0, 2000),
      })).filter((p: any) => p.name && /^https:\/\//i.test(p.baseUrl) && p.model && p.apiKey);
      if (!providers.length) return json({ error: "No complete HTTPS AI providers were supplied." }, 400);
      const encrypted_payload = await encrypt(providers);
      const { error } = await admin.from("forgepilot_provider_vault").upsert({ user_id: user.id, encrypted_payload, updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ success: true });
    }
    if (body.action === "load") {
      const { data, error } = await admin.from("forgepilot_provider_vault").select("encrypted_payload").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      return json({ providers: data ? await decrypt(data.encrypted_payload) : [] });
    }
    if (body.action === "delete") {
      const { error } = await admin.from("forgepilot_provider_vault").delete().eq("user_id", user.id);
      if (error) throw error;
      return json({ success: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected vault error." }, 500);
  }
});
