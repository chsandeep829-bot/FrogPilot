-- ForgePilot cloud account and project storage.
-- Run this in Supabase SQL Editor. Row Level Security keeps each account's records private.
create table if not exists public.forgepilot_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.forgepilot_profiles enable row level security;
drop policy if exists "Users read own ForgePilot profile" on public.forgepilot_profiles;
create policy "Users read own ForgePilot profile" on public.forgepilot_profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "Users insert own ForgePilot profile" on public.forgepilot_profiles;
create policy "Users insert own ForgePilot profile" on public.forgepilot_profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "Users update own ForgePilot profile" on public.forgepilot_profiles;
create policy "Users update own ForgePilot profile" on public.forgepilot_profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create table if not exists public.forgepilot_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  backend_job_id text not null,
  name text not null default 'Untitled project',
  summary text not null default '',
  files jsonb not null default '[]'::jsonb,
  chat jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, backend_job_id)
);
alter table public.forgepilot_projects enable row level security;
drop policy if exists "Users read own ForgePilot projects" on public.forgepilot_projects;
create policy "Users read own ForgePilot projects" on public.forgepilot_projects for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own ForgePilot projects" on public.forgepilot_projects;
create policy "Users insert own ForgePilot projects" on public.forgepilot_projects for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own ForgePilot projects" on public.forgepilot_projects;
create policy "Users update own ForgePilot projects" on public.forgepilot_projects for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own ForgePilot projects" on public.forgepilot_projects;
create policy "Users delete own ForgePilot projects" on public.forgepilot_projects for delete to authenticated using (auth.uid() = user_id);

-- API keys are ciphertext only. Access is restricted to the service-role Edge Function.
create table if not exists public.forgepilot_provider_vault (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_payload text not null,
  updated_at timestamptz not null default now()
);
alter table public.forgepilot_provider_vault enable row level security;
revoke all on public.forgepilot_provider_vault from anon, authenticated;
