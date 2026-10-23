# ForgePilot Supabase setup (static hosting)

This adds account profiles, cross-device project sync, an encrypted per-user AI-key vault, and an Edge Function path for AI generation/editing when the Node.js API is unavailable. The existing Node.js API remains supported.

## 1. Create a Supabase project
1. Create a project at https://supabase.com/.
2. In Project Settings → API, copy the Project URL and the public anon/publishable key into ForgePilot Settings. Never put the service-role key in the browser.
3. In Authentication → Providers, enable Email. Configure email confirmation as you prefer for your app.

## 2. Create the database tables
Open SQL Editor in Supabase and run the complete SQL in `supabase/migrations/202610230001_forgepilot_cloud.sql`. The profile and project tables use row-level security so users can only access their own rows. The provider-vault table has no client read/write grants; only the Edge Functions use the service role.

## 3. Deploy the Edge Functions
Install the Supabase CLI and link this repository to your project, then run:
```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set PROVIDER_VAULT_ENCRYPTION_KEY="$(openssl rand -hex 32)"
supabase functions deploy provider-vault
supabase functions deploy forgepilot-ai
```
If your shell does not support `openssl`, generate a random secret of at least 32 characters using a trusted password generator. Keep it private and do not commit it. Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions in its hosted environment; if they are missing in your project, configure them as Edge Function secrets.

## 4. Use it
1. Open ForgePilot Settings and enter the Supabase Project URL and public anon/publishable key.
2. Create an account or sign in.
3. Add your AI provider name, HTTPS base URL, model ID, and API key, then tap **Save AI keys to encrypted vault**.
4. Generate an app. ForgePilot first tries its existing Node.js backend; if it is unavailable and you are signed in, it uses the Supabase `forgepilot-ai` Edge Function.
5. Cloud-saved projects sync to your account and can be reopened on another device after sign-in.

## Security and limitations
- Only the Supabase public anon/publishable key belongs in the frontend. Never expose the Supabase service-role key or the vault encryption secret.
- Provider keys are encrypted using AES-GCM before they are written to the vault table. The encryption secret is held as an Edge Function secret, not in this repository.
- This is a foundation, not a production security audit. Use HTTPS, configure your allowed auth redirect URLs, add rate limits/quotas for Edge Function usage, and monitor provider costs before opening public registration.
- The static Edge Function path supports generation and chat editing. Publishing and ZIP export still depend on the existing Node.js backend; those buttons remain unavailable for cloud-only projects.
