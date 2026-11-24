-- =============================================================
-- SONA — SCHEMA SUPABASE (AUTENTICAÇÃO, CONTAS & VAGAS POR USUÁRIO)
-- Execute este script no SQL Editor do seu projeto Supabase após
-- schema_supabase.sql e schema_curriculo_supabase.sql.
-- Idempotente: seguro para execução repetida.
-- =============================================================

-- 1. FUNÇÃO COMPARTILHADA DE updated_at
create or replace function public.sona_set_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

-- 2. CONFIGURAÇÕES E PERFIL DA CONTA (1 linha por usuário)
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  handle text not null default '',
  avatar_url text not null default '',
  daily_goal integer not null default 3 check (daily_goal between 1 and 50),
  crawler_params jsonb not null default '{}'::jsonb,
  byok_provider text not null default 'gemini',
  byok_model text not null default 'gemini-2.5-flash',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.user_settings enable row level security;

drop policy if exists "Usuario le proprio user_settings" on public.user_settings;
create policy "Usuario le proprio user_settings"
  on public.user_settings for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Usuario insere proprio user_settings" on public.user_settings;
create policy "Usuario insere proprio user_settings"
  on public.user_settings for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Usuario atualiza proprio user_settings" on public.user_settings;
create policy "Usuario atualiza proprio user_settings"
  on public.user_settings for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Usuario deleta proprio user_settings" on public.user_settings;
create policy "Usuario deleta proprio user_settings"
  on public.user_settings for delete
  to authenticated
  using (auth.uid() = user_id);

drop trigger if exists trg_user_settings_updated_at on public.user_settings;
create trigger trg_user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.sona_set_updated_at();

-- 3. TRIGGER AUTOMÁTICO DE PROVISIONAMENTO NO CADASTRO (E-mail ou OAuth)
create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = public
as $$
declare
  raw_name text;
  raw_handle text;
  raw_avatar text;
  email_prefix text;
begin
  email_prefix := split_part(coalesce(new.email, ''), '@', 1);
  raw_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(email_prefix), ''),
    'Usuário Sona'
  );
  raw_handle := coalesce(
    nullif(trim(new.raw_user_meta_data->>'user_name'), ''),
    nullif(regexp_replace(lower(email_prefix), '[^a-z0-9_.-]', '', 'g'), ''),
    'usuario'
  );
  if left(raw_handle, 1) <> '@' then
    raw_handle := '@' || raw_handle;
  end if;
  raw_avatar := coalesce(new.raw_user_meta_data->>'avatar_url', '');

  insert into public.user_settings (user_id, display_name, handle, avatar_url)
  values (new.id, raw_name, raw_handle, raw_avatar)
  on conflict (user_id) do nothing;

  return new;
end;
$$ language plpgsql;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. INTERAÇÕES E CANDIDATURAS INDIVIDUAIS POR VAGA
create table if not exists public.user_vagas (
  user_id uuid not null references auth.users(id) on delete cascade,
  vaga_key text not null,
  vaga_id text,
  status text not null default 'para_aplicar',
  starred boolean not null default false,
  etapa_concluida boolean not null default false,
  candidatura_externa boolean not null default false,
  data_aplicacao text,
  inicio_candidatura bigint,
  tempo_gasto_segundos integer,
  motivo_mismatch text not null default '',
  detalhe_mismatch text not null default '',
  data_mismatch text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (user_id, vaga_key)
);

create index if not exists idx_user_vagas_user_status
  on public.user_vagas (user_id, status);

alter table public.user_vagas enable row level security;

drop policy if exists "Usuario le proprias user_vagas" on public.user_vagas;
create policy "Usuario le proprias user_vagas"
  on public.user_vagas for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Usuario insere proprias user_vagas" on public.user_vagas;
create policy "Usuario insere proprias user_vagas"
  on public.user_vagas for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Usuario atualiza proprias user_vagas" on public.user_vagas;
create policy "Usuario atualiza proprias user_vagas"
  on public.user_vagas for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Usuario deleta proprias user_vagas" on public.user_vagas;
create policy "Usuario deleta proprias user_vagas"
  on public.user_vagas for delete
  to authenticated
  using (auth.uid() = user_id);

drop trigger if exists trg_user_vagas_updated_at on public.user_vagas;
create trigger trg_user_vagas_updated_at
  before update on public.user_vagas
  for each row execute function public.sona_set_updated_at();

-- 5. SAAS FECHADO: RESTRINGE CATÁLOGO DE VAGAS E TELEMETRIA A SESSÕES AUTENTICADAS
drop policy if exists "Permitir leitura pública das vagas" on public.vagas;
drop policy if exists "Permitir leitura publica de vagas" on public.vagas;
drop policy if exists "Permitir leitura autenticada de vagas" on public.vagas;
create policy "Permitir leitura autenticada de vagas"
  on public.vagas for select
  to authenticated
  using (true);

drop policy if exists "Permitir leitura publica do historico" on public.historico_execucoes;
drop policy if exists "Permitir leitura autenticada do historico" on public.historico_execucoes;
create policy "Permitir leitura autenticada do historico"
  on public.historico_execucoes for select
  to authenticated
  using (true);
