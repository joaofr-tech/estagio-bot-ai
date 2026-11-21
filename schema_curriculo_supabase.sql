-- =============================================================
-- SONA RESUME STUDIO — SCHEMA SUPABASE (PARTE 1)
-- Execute este script no SQL Editor do seu projeto Supabase
-- =============================================================

-- 1. BANCO DE FATOS UNIFICADO (Master Profile por usuário)
create table if not exists public.master_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  basics jsonb not null default '{}'::jsonb,
  education jsonb not null default '[]'::jsonb,
  experiences jsonb not null default '[]'::jsonb,
  projects jsonb not null default '[]'::jsonb,
  skills_whitelist text[] not null default '{}'::text[],
  certifications jsonb not null default '[]'::jsonb,
  languages_spoken jsonb not null default '[]'::jsonb,
  github_username text default '',
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.master_profiles enable row level security;

drop policy if exists "Usuario le proprio master_profile" on public.master_profiles;
create policy "Usuario le proprio master_profile"
  on public.master_profiles for select
  using (auth.uid() = user_id);

drop policy if exists "Usuario insere proprio master_profile" on public.master_profiles;
create policy "Usuario insere proprio master_profile"
  on public.master_profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "Usuario atualiza proprio master_profile" on public.master_profiles;
create policy "Usuario atualiza proprio master_profile"
  on public.master_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. HISTÓRICO DE CURRÍCULOS ATS GERADOS (Vinculado à vaga)
create table if not exists public.curriculos_gerados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vaga_id text not null,
  vaga_empresa text default '',
  vaga_cargo text default '',
  idioma text not null default 'pt-BR',
  jd_snapshot text not null default '',
  match_report jsonb not null default '{}'::jsonb,
  resume_json jsonb not null default '{}'::jsonb,
  audit_report jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists idx_curriculos_user_vaga
  on public.curriculos_gerados (user_id, vaga_id, created_at desc);

alter table public.curriculos_gerados enable row level security;

drop policy if exists "Usuario le proprios curriculos" on public.curriculos_gerados;
create policy "Usuario le proprios curriculos"
  on public.curriculos_gerados for select
  using (auth.uid() = user_id);

drop policy if exists "Usuario insere proprios curriculos" on public.curriculos_gerados;
create policy "Usuario insere proprios curriculos"
  on public.curriculos_gerados for insert
  with check (auth.uid() = user_id);

drop policy if exists "Usuario atualiza proprios curriculos" on public.curriculos_gerados;
create policy "Usuario atualiza proprios curriculos"
  on public.curriculos_gerados for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Usuario deleta proprios curriculos" on public.curriculos_gerados;
create policy "Usuario deleta proprios curriculos"
  on public.curriculos_gerados for delete
  using (auth.uid() = user_id);

-- 3. TRIGGER AUTOMÁTICO DE updated_at
create or replace function public.sona_set_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_master_profiles_updated_at on public.master_profiles;
create trigger trg_master_profiles_updated_at
  before update on public.master_profiles
  for each row execute function public.sona_set_updated_at();

drop trigger if exists trg_curriculos_gerados_updated_at on public.curriculos_gerados;
create trigger trg_curriculos_gerados_updated_at
  before update on public.curriculos_gerados
  for each row execute function public.sona_set_updated_at();
