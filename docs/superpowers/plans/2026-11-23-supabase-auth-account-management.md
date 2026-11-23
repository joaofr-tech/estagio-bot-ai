# Autenticação & Gerenciamento de Contas via Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar autenticação obrigatória (E-mail/Senha, Recuperação de Senha e GitHub OAuth) e gerenciamento completo de contas individuais com isolamento por usuário via Supabase Auth + PostgreSQL RLS em todo o Sona (`dashboard.html`, `index.html` e `curriculo.html`).

**Architecture:** Uma página dedicada `auth.html` concentra os fluxos de entrada sobre o Design System Obsidian Dark, enquanto um módulo isomórfico `auth_guard.js` bloqueia acessos anônimos sem flash visual, gerencia chaves locais escopadas por `user_id` e traduz o estado de vagas entre o cliente e as tabelas normalizadas `public.user_settings` e `public.user_vagas` protegidas por RLS (`auth.uid() = user_id`). Apenas a exclusão definitiva da própria conta passa por um endpoint serverless mínimo (`DELETE /api/account`) usando `SUPABASE_SERVICE_ROLE_KEY`.

**Tech Stack:** HTML5/CSS3 (`design-system.css`), Vanilla JS (CommonJS + Browser UMD), `@supabase/supabase-js` v2, PostgreSQL + Row Level Security (Supabase), Vercel Serverless Functions (Node.js >= 20), Python 3.12 + Playwright (`pytest`).

**Spec:** `docs/superpowers/specs/2026-11-23-supabase-auth-account-management-design.md`

## Global Constraints

- **Acesso fechado obrigatório:** nenhuma tela operacional (`dashboard.html`, `index.html`, `curriculo.html`) e nenhuma leitura de `public.vagas` / `public.historico_execucoes` é permitida sem sessão autenticada.
- **Isolamento estrito (`auth.uid() = user_id`):** todas as tabelas de usuário (`user_settings`, `user_vagas`, `master_profiles`, `curriculos_gerados`) exigem RLS por `user_id`, e todos os caches em `localStorage` incluem `<uid>`.
- **Zero-Knowledge para chave BYOK:** apenas `byok_provider` e `byok_model` vão para `user_settings`; a `apiKey` secreta permanece exclusivamente no navegador em `sona_byok_key_<uid>` (criptografia na nuvem fica na Issue #7).
- **Regras visuais estritas (`DESIGN.md`):** ZERO emojis em qualquer elemento novo de UI/toast/alerta, ZERO card dentro de card (máximo 1 nível de superfície), superfícies `#111114` / `#17171B` / `#1E1E23`, botões `.sona-btn-primary` / `.sona-btn-secondary` e microcopy em Title Case em Português.
- **Sincronia de artefatos estáticos (`.github/workflows/ci.yml`):** `index.html` deve permanecer idêntico a `dashboard.html`, e `npm run build` deve manter `public/` sem diffs pendentes (`git diff --exit-code public/`).

---

## File Structure

### Novos Arquivos
- `schema_auth_supabase.sql` — Schema idempotente de `public.user_settings`, `public.user_vagas`, trigger `on_auth_user_created` (`public.handle_new_user`) e políticas RLS (incluindo atualização `to authenticated` em `vagas` e `historico_execucoes`).
- `auth_guard.js` — Módulo UMD/CommonJS (`window.SonaAuth` no navegador, `module.exports` no Node) com singleton Supabase, guard anti-FOUC, sanitização anti-*open-redirect*, chaves `localStorage` por `user_id`, serialização `store <-> user_vagas`, detecção de dados legados e tradutor PT-BR de erros de Auth.
- `auth.css` — Estilos dedicados para `auth.html` herdando `design-system.css` (1 nível de superfície, responsivo, sem card aninhado).
- `auth.html` — Tela dedicada com modos `Entrar`, `Criar Conta`, `Recuperar Senha`, `Definir Nova Senha` e botão `Continuar com GitHub`.
- `api/account.js` — Serverless function `DELETE /api/account` validando Bearer JWT + confirmação `'EXCLUIR'` e executando `auth.admin.deleteUser(user.id)`.
- `tests/auth_and_account.test.js` — Suíte de testes unitários e de integração em Node.js para `auth_guard.js`, `api/account.js`, schema/artefatos estáticos e regras de `DESIGN.md`.

### Arquivos Modificados
- `tests/run_all_tests.js` — Registra e executa `runAuthAndAccountTests()`.
- `tests/api_and_security.test.js` — Testa bloqueio de `schema_auth_supabase.sql` e `docs/` e liberação de `auth.html`, `auth.css` e `auth_guard.js` em `servidor.js`.
- `servidor.js` — Habilita método `DELETE` e header `X-Confirm-Delete` no CORS, roteia `DELETE /api/*` e bloqueia a pasta `docs/`.
- `vercel.json` — Adiciona configuração de `api/account.js` (`maxDuration: 15`).
- `.vercelignore` — Ignora `docs/` e `schema_auth_supabase.sql` no deploy estático.
- `scripts/build_dashboard.js` — Copia `dashboard.html` sobre `index.html` antes de empacotar e inclui `auth.html`, `auth.css` e `auth_guard.js` na cópia para `public/`.
- `curriculo.html` & `curriculo.js` — Ativa guard `SonaAuth.requireSession()`, remove modo anônimo local, escopa caches por `<uid>` e sincroniza `byok_provider`/`byok_model` em `user_settings`.
- `dashboard.html` & `index.html` — Ativa guard `SonaAuth.requireSession()`, sincroniza `user_settings` e `user_vagas` com UI otimista + fila offline, dinamiza `daily_goal` e card da sidebar, e implementa a Tela 07 (`Configurações`) completa (perfil, senha, exportação JSON, importação de dados legados e exclusão de conta).
- `tests_py/test_e2e_studio.py` — Testa redirecionamento anônimo para `/auth.html`, alternância de abas de autenticação e fluxos logados completos com mock de rede Supabase.
- `README.md` — Documenta `schema_auth_supabase.sql` e URLs de redirecionamento do Supabase Auth.

---

### Task 1: Schema SQL (`schema_auth_supabase.sql`) & Núcleo Isomórfico `auth_guard.js`

**Files:**
- Create: `schema_auth_supabase.sql`
- Create: `auth_guard.js`
- Create: `tests/auth_and_account.test.js`
- Modify: `tests/run_all_tests.js`

**Interfaces:**
- Consumes: `window.SUPABASE_CONFIG` (`{ url, anonKey }`) e `window.supabase.createClient` quando executado no navegador.
- Produces (`auth_guard.js` / `window.SonaAuth`):
  - `sanitizeNextPath(rawNext, fallback = '/dashboard.html') -> string`
  - `getUserScopedKeys(userId) -> { USER_STORE, PARAMS, PENDING_SYNC, PROFILE, HISTORY, BYOK_KEY, ACTIVE_JOB }`
  - `LEGACY_STORAGE_KEYS -> { USER_STORE, PARAMS, PROFILE, HISTORY, BYOK }`
  - `isNeutralVagaEntry(entry) -> boolean`
  - `storeEntryToDbRow(userId, vagaKey, entry, vagaId = null) -> object`
  - `dbRowToStoreEntry(row) -> { vagaKey: string, entry: object }`
  - `deriveUserIdentity(user, settings = null) -> { displayName, handle, email, initials, avatarUrl, provider, dailyGoal }`
  - `translateAuthError(errOrMessage) -> string`
  - `detectLegacyLocalData(storage) -> { hasLegacy: boolean, counts: object }`
  - Browser runtime methods: `getClient()`, `requireSession()`, `signOut(redirectUrl)`, `getAccessToken()`

- [ ] **Step 1: Escrever os testes unitários falhando em `tests/auth_and_account.test.js` e registrá-los em `tests/run_all_tests.js`**

Criar `tests/auth_and_account.test.js`:

```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SonaAuth = require('../auth_guard');

async function runAuthAndAccountTests() {
  console.log('\n--- Testes: Autenticação Supabase, Isolamento por Usuário & Gerenciamento de Conta ---');

  // 1. Prevenção de Open Redirect em sanitizeNextPath
  assert.strictEqual(SonaAuth.sanitizeNextPath('/dashboard.html'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('/curriculo.html?view=profile'), '/curriculo.html?view=profile');
  assert.strictEqual(SonaAuth.sanitizeNextPath('https://evil.com/phish'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('//evil.com/phish'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('javascript:alert(1)'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('/auth.html'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath(''), '/dashboard.html');
  console.log('  ✓ sanitizeNextPath bloqueia open-redirects e loops para /auth.html');

  // 2. Isolamento de chaves localStorage por user_id
  const keysA = SonaAuth.getUserScopedKeys('user-111');
  const keysB = SonaAuth.getUserScopedKeys('user-222');
  assert.notStrictEqual(keysA.USER_STORE, keysB.USER_STORE);
  assert.notStrictEqual(keysA.BYOK_KEY, keysB.BYOK_KEY);
  assert.strictEqual(keysA.USER_STORE, 'sona_user_store_user-111');
  assert.strictEqual(keysA.PARAMS, 'sona_params_user-111');
  assert.strictEqual(keysA.BYOK_KEY, 'sona_byok_key_user-111');
  console.log('  ✓ getUserScopedKeys isola completamente o cache entre contas distintas');

  // 3. Detecção de estado neutro e conversão bidirecional store <-> user_vagas
  assert.strictEqual(SonaAuth.isNeutralVagaEntry({ status: 'para_aplicar', starred: false }), true);
  assert.strictEqual(SonaAuth.isNeutralVagaEntry({ status: 'para_aplicar', starred: true }), false);
  assert.strictEqual(SonaAuth.isNeutralVagaEntry({ status: 'aplicada', starred: false }), false);

  const richEntry = {
    status: 'aplicada',
    starred: true,
    etapaConcluida: true,
    candidaturaExterna: false,
    dataAplicacao: '23/11/2026, 19:30:00',
    inicioCandidatura: 1795470000000,
    tempoGastoSegundos: 145,
    motivoMismatch: '',
    detalheMismatch: '',
    dataMismatch: null,
    dataConclusaoEtapa: '23/11/2026, 20:00:00',
    ultimoAssuntoConcluido: 'Teste Técnico Python',
    ultimaDataRecebimentoConcluida: '23/11/2026, 19:40:00',
    detalhesAcao: { tipo: 'Teste', assunto: 'Teste Técnico Python' }
  };

  const dbRow = SonaAuth.storeEntryToDbRow('uuid-abc', 'ifood::estagio dados', richEntry, 'vaga-99');
  assert.strictEqual(dbRow.user_id, 'uuid-abc');
  assert.strictEqual(dbRow.vaga_key, 'ifood::estagio dados');
  assert.strictEqual(dbRow.vaga_id, 'vaga-99');
  assert.strictEqual(dbRow.status, 'aplicada');
  assert.strictEqual(dbRow.starred, true);
  assert.strictEqual(dbRow.tempo_gasto_segundos, 145);
  assert.strictEqual(dbRow.metadata.ultimoAssuntoConcluido, 'Teste Técnico Python');

  const restored = SonaAuth.dbRowToStoreEntry(dbRow);
  assert.strictEqual(restored.vagaKey, 'ifood::estagio dados');
  assert.strictEqual(restored.entry.status, 'aplicada');
  assert.strictEqual(restored.entry.starred, true);
  assert.strictEqual(restored.entry.etapaConcluida, true);
  assert.strictEqual(restored.entry.tempoGastoSegundos, 145);
  assert.strictEqual(restored.entry.ultimoAssuntoConcluido, 'Teste Técnico Python');
  assert.strictEqual(restored.entry.detalhesAcao.assunto, 'Teste Técnico Python');
  console.log('  ✓ Conversão bidirecional store <-> public.user_vagas sem perda de metadados');

  // 4. Identidade derivada e tradução de erros do Supabase Auth
  const identity = SonaAuth.deriveUserIdentity(
    {
      email: 'joao.silva@exemplo.com',
      app_metadata: { provider: 'github' },
      user_metadata: { full_name: 'João Silva', user_name: 'joaosilva', avatar_url: 'https://avatars.example/u/1' }
    },
    { display_name: '', handle: '', daily_goal: 4 }
  );
  assert.strictEqual(identity.displayName, 'João Silva');
  assert.strictEqual(identity.handle, '@joaosilva');
  assert.strictEqual(identity.initials, 'JS');
  assert.strictEqual(identity.provider, 'github');
  assert.strictEqual(identity.dailyGoal, 4);

  assert.ok(SonaAuth.translateAuthError('Invalid login credentials').includes('E-mail ou senha incorretos'));
  assert.ok(SonaAuth.translateAuthError('User already registered').includes('já possui cadastro'));
  console.log('  ✓ deriveUserIdentity e translateAuthError geram microcopy limpa em PT-BR');

  // 5. Detecção de dados legados no navegador
  const fakeStorage = {
    data: {
      estagios_user_store: JSON.stringify({ 'emp::cargo': { status: 'aplicada' } }),
      sona_byok_config_v1: JSON.stringify({ provider: 'gemini', apiKey: 'AIzaTest' })
    },
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; }
  };
  const legacyReport = SonaAuth.detectLegacyLocalData(fakeStorage);
  assert.strictEqual(legacyReport.hasLegacy, true);
  assert.strictEqual(legacyReport.counts.vagas, 1);
  assert.strictEqual(legacyReport.counts.hasByokKey, true);
  console.log('  ✓ detectLegacyLocalData identifica registros antigos para migração assistida');

  // 6. Validação estrutural de schema_auth_supabase.sql
  const sqlPath = path.resolve(__dirname, '..', 'schema_auth_supabase.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.ok(sql.includes('create table if not exists public.user_settings'), 'Deve criar user_settings');
  assert.ok(sql.includes('create table if not exists public.user_vagas'), 'Deve criar user_vagas');
  assert.ok(sql.includes('on_auth_user_created'), 'Deve criar trigger on_auth_user_created');
  assert.ok(sql.includes('to authenticated'), 'Deve restringir leitura de vagas a authenticated');
  console.log('  ✓ schema_auth_supabase.sql contém tabelas, trigger e políticas RLS autenticadas');
}

module.exports = { runAuthAndAccountTests };
```

Atualizar `tests/run_all_tests.js` adicionando a importação e chamada de `runAuthAndAccountTests`:

```javascript
const { runCandidaturasTests } = require('./candidaturas.test');
const { runIndicadoresTests } = require('./indicadores.test');
const { runParametrosTests } = require('./parametros.test');
const { runCrawlerGerenciadorTests } = require('./crawler_gerenciador.test');
const { runObservabilidadeTests } = require('./observabilidade.test');
const { runResumeEngineTests } = require('./resume_engine.test');
const { runApiAndSecurityTests } = require('./api_and_security.test');
const { runAuthAndAccountTests } = require('./auth_and_account.test');

async function runAll() {
  const start = Date.now();
  console.log('====================================================');
  console.log('       SUÍTE DE TESTES AUTOMATIZADOS DO PROJETO     ');
  console.log('====================================================');

  try {
    runCandidaturasTests();
    runIndicadoresTests();
    runParametrosTests();
    runCrawlerGerenciadorTests();
    runObservabilidadeTests();
    await runResumeEngineTests();
    await runApiAndSecurityTests();
    await runAuthAndAccountTests();

    const elapsed = Date.now() - start;
    console.log('\n====================================================');
    console.log(`✓ TODOS OS TESTES PASSARAM COM SUCESSO! (${elapsed}ms)`);
    console.log('====================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ FALHA NOS TESTES:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runAll();
```

- [ ] **Step 2: Executar `npm test` para confirmar que falha pela ausência de `auth_guard.js`**

Run: `npm test`
Expected: FAIL com `Cannot find module '../auth_guard'`

- [ ] **Step 3: Criar `schema_auth_supabase.sql` e `auth_guard.js`**

Criar `schema_auth_supabase.sql`:

```sql
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
```

Criar `auth_guard.js`:

```javascript
/* =============================================================
   SONA AUTH GUARD & USER ISOLATION HELPERS (auth_guard.js)
   Compatível com Browser (window.SonaAuth) e Node.js (CommonJS)
   ============================================================= */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.SonaAuth = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const LEGACY_STORAGE_KEYS = {
    USER_STORE: 'estagios_user_store',
    PARAMS: 'estagios_crawler_params',
    PROFILE: 'sona_master_profile_v1',
    HISTORY: 'sona_resume_history_v1',
    BYOK: 'sona_byok_config_v1'
  };

  let _client = null;
  let _session = null;
  let _user = null;
  let _authListenerAttached = false;

  function sanitizeNextPath(rawNext, fallback = '/dashboard.html') {
    if (!rawNext || typeof rawNext !== 'string') return fallback;
    const trimmed = rawNext.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('://')) {
      return fallback;
    }
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('/auth.html') || lower.startsWith('javascript:')) {
      return fallback;
    }
    return trimmed;
  }

  function getUserScopedKeys(userId) {
    const uid = String(userId || 'anon').trim() || 'anon';
    return {
      USER_STORE: `sona_user_store_${uid}`,
      PARAMS: `sona_params_${uid}`,
      PENDING_SYNC: `sona_pending_sync_${uid}`,
      PROFILE: `sona_profile_${uid}`,
      HISTORY: `sona_history_${uid}`,
      BYOK_KEY: `sona_byok_key_${uid}`,
      ACTIVE_JOB: `sona_active_job_${uid}`
    };
  }

  function isNeutralVagaEntry(entry) {
    if (!entry || typeof entry !== 'object') return true;
    const status = entry.status || 'para_aplicar';
    return (
      status === 'para_aplicar' &&
      !entry.starred &&
      !entry.etapaConcluida &&
      !entry.candidaturaExterna &&
      !entry.motivoMismatch &&
      !entry.dataAplicacao &&
      !entry.inicioCandidatura
    );
  }

  function storeEntryToDbRow(userId, vagaKey, entry, vagaId = null) {
    const safe = entry || {};
    const metadata = {};
    if (safe.detalhesAcao) metadata.detalhesAcao = safe.detalhesAcao;
    if (safe.dataConclusaoEtapa) metadata.dataConclusaoEtapa = safe.dataConclusaoEtapa;
    if (safe.ultimoAssuntoConcluido) metadata.ultimoAssuntoConcluido = safe.ultimoAssuntoConcluido;
    if (safe.ultimaDataRecebimentoConcluida) {
      metadata.ultimaDataRecebimentoConcluida = safe.ultimaDataRecebimentoConcluida;
    }
    if (safe.motivoEncerramento) metadata.motivoEncerramento = safe.motivoEncerramento;

    return {
      user_id: userId,
      vaga_key: vagaKey,
      vaga_id: vagaId || safe.vagaId || null,
      status: safe.status || 'para_aplicar',
      starred: Boolean(safe.starred),
      etapa_concluida: Boolean(safe.etapaConcluida),
      candidatura_externa: Boolean(safe.candidaturaExterna),
      data_aplicacao: safe.dataAplicacao || null,
      inicio_candidatura: typeof safe.inicioCandidatura === 'number' ? safe.inicioCandidatura : null,
      tempo_gasto_segundos: typeof safe.tempoGastoSegundos === 'number' ? safe.tempoGastoSegundos : null,
      motivo_mismatch: safe.motivoMismatch || '',
      detalhe_mismatch: safe.detalheMismatch || '',
      data_mismatch: safe.dataMismatch || null,
      metadata
    };
  }

  function dbRowToStoreEntry(row) {
    const meta = (row && typeof row.metadata === 'object' && row.metadata) || {};
    const entry = {
      status: row.status || 'para_aplicar',
      starred: Boolean(row.starred),
      etapaConcluida: Boolean(row.etapa_concluida),
      candidaturaExterna: Boolean(row.candidatura_externa)
    };
    if (row.vaga_id) entry.vagaId = row.vaga_id;
    if (row.data_aplicacao) entry.dataAplicacao = row.data_aplicacao;
    if (typeof row.inicio_candidatura === 'number') entry.inicioCandidatura = row.inicio_candidatura;
    if (typeof row.tempo_gasto_segundos === 'number') entry.tempoGastoSegundos = row.tempo_gasto_segundos;
    if (row.motivo_mismatch) entry.motivoMismatch = row.motivo_mismatch;
    if (row.detalhe_mismatch) entry.detalheMismatch = row.detalhe_mismatch;
    if (row.data_mismatch) entry.dataMismatch = row.data_mismatch;
    if (meta.detalhesAcao) entry.detalhesAcao = meta.detalhesAcao;
    if (meta.dataConclusaoEtapa) entry.dataConclusaoEtapa = meta.dataConclusaoEtapa;
    if (meta.ultimoAssuntoConcluido) entry.ultimoAssuntoConcluido = meta.ultimoAssuntoConcluido;
    if (meta.ultimaDataRecebimentoConcluida) {
      entry.ultimaDataRecebimentoConcluida = meta.ultimaDataRecebimentoConcluida;
    }
    if (meta.motivoEncerramento) entry.motivoEncerramento = meta.motivoEncerramento;

    return { vagaKey: row.vaga_key, entry };
  }

  function computeInitials(nameOrEmail) {
    const clean = String(nameOrEmail || '').trim();
    if (!clean) return 'US';
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }

  function deriveUserIdentity(user, settings = null) {
    const u = user || {};
    const meta = u.user_metadata || {};
    const appMeta = u.app_metadata || {};
    const cfg = settings || {};
    const email = u.email || '';
    const emailPrefix = email.split('@')[0] || 'usuario';

    const displayName =
      (cfg.display_name && cfg.display_name.trim()) ||
      (meta.full_name && String(meta.full_name).trim()) ||
      (meta.name && String(meta.name).trim()) ||
      emailPrefix;

    let rawHandle =
      (cfg.handle && cfg.handle.trim()) ||
      (meta.user_name && String(meta.user_name).trim()) ||
      emailPrefix.toLowerCase().replace(/[^a-z0-9_.-]/g, '') ||
      'usuario';
    if (!rawHandle.startsWith('@')) rawHandle = `@${rawHandle}`;

    const avatarUrl = (cfg.avatar_url && cfg.avatar_url.trim()) || meta.avatar_url || '';
    const provider = appMeta.provider || (Array.isArray(appMeta.providers) && appMeta.providers[0]) || 'email';
    const dailyGoalNum = Number(cfg.daily_goal);
    const dailyGoal = Number.isFinite(dailyGoalNum) && dailyGoalNum >= 1 && dailyGoalNum <= 50 ? dailyGoalNum : 3;

    return {
      displayName,
      handle: rawHandle,
      email,
      initials: computeInitials(displayName),
      avatarUrl,
      provider,
      dailyGoal
    };
  }

  function translateAuthError(errOrMessage) {
    const raw = String((errOrMessage && errOrMessage.message) || errOrMessage || '').trim();
    const low = raw.toLowerCase();
    if (!raw) return 'Não foi possível concluir a operação. Tente novamente.';
    if (low.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
    if (low.includes('email not confirmed')) return 'Confirme seu e-mail através do link enviado antes de entrar.';
    if (low.includes('user already registered') || low.includes('already been registered')) {
      return 'Este e-mail já possui cadastro. Use a aba Entrar ou recupere sua senha.';
    }
    if (low.includes('password should be at least')) return 'A senha deve ter pelo menos 8 caracteres.';
    if (low.includes('rate limit') || low.includes('over_email_send_rate_limit')) {
      return 'Muitas tentativas seguidas. Aguarde alguns instantes antes de tentar novamente.';
    }
    if (low.includes('same password') || low.includes('different from the old password')) {
      return 'A nova senha deve ser diferente da senha atual.';
    }
    return raw;
  }

  function detectLegacyLocalData(storage) {
    const st = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const counts = { vagas: 0, hasParams: false, hasProfile: false, history: 0, hasByokKey: false };
    if (!st) return { hasLegacy: false, counts };

    try {
      const rawStore = st.getItem(LEGACY_STORAGE_KEYS.USER_STORE);
      if (rawStore) {
        const parsed = JSON.parse(rawStore);
        counts.vagas = Object.keys(parsed || {}).filter((k) => !isNeutralVagaEntry(parsed[k])).length;
      }
    } catch (_) {}

    try {
      counts.hasParams = Boolean(st.getItem(LEGACY_STORAGE_KEYS.PARAMS));
    } catch (_) {}

    try {
      const rawProf = st.getItem(LEGACY_STORAGE_KEYS.PROFILE);
      if (rawProf) {
        const prof = JSON.parse(rawProf);
        counts.hasProfile = Boolean(
          (prof.basics && prof.basics.name) ||
            (Array.isArray(prof.projects) && prof.projects.length > 0) ||
            (Array.isArray(prof.experiences) && prof.experiences.length > 0)
        );
      }
    } catch (_) {}

    try {
      const rawHist = st.getItem(LEGACY_STORAGE_KEYS.HISTORY);
      if (rawHist) {
        const arr = JSON.parse(rawHist);
        counts.history = Array.isArray(arr) ? arr.length : 0;
      }
    } catch (_) {}

    try {
      const rawByok = st.getItem(LEGACY_STORAGE_KEYS.BYOK);
      if (rawByok) {
        const cfg = JSON.parse(rawByok);
        counts.hasByokKey = Boolean(cfg && cfg.apiKey);
      }
    } catch (_) {}

    const hasLegacy =
      counts.vagas > 0 || counts.hasParams || counts.hasProfile || counts.history > 0 || counts.hasByokKey;
    return { hasLegacy, counts };
  }

  function getClient() {
    if (_client) return _client;
    if (typeof window === 'undefined') return null;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
    if (!window.SUPABASE_CONFIG || !window.SUPABASE_CONFIG.url || !window.SUPABASE_CONFIG.anonKey) return null;

    _client = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    return _client;
  }

  function redirectToAuth(customUrl) {
    if (typeof window === 'undefined') return;
    const currentPath = window.location.pathname + window.location.search;
    const nextParam = encodeURIComponent(sanitizeNextPath(currentPath, '/dashboard.html'));
    const target = customUrl || `/auth.html?next=${nextParam}`;
    try {
      if (window.top && window.top !== window) {
        window.top.location.replace(target);
        return;
      }
    } catch (_) {}
    window.location.replace(target);
  }

  async function requireSession(options = {}) {
    const client = getClient();
    if (!client) {
      redirectToAuth('/auth.html?error=config');
      return null;
    }

    const { data, error } = await client.auth.getSession();
    if (error || !data || !data.session || !data.session.user) {
      redirectToAuth();
      return null;
    }

    _session = data.session;
    _user = data.session.user;

    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove('auth-pending');
    }

    if (!_authListenerAttached) {
      _authListenerAttached = true;
      client.auth.onAuthStateChange((event, newSession) => {
        _session = newSession || null;
        _user = newSession?.user || null;
        if (event === 'SIGNED_OUT' || !newSession) {
          redirectToAuth('/auth.html');
          return;
        }
        if (typeof options.onSessionUpdate === 'function') {
          options.onSessionUpdate(newSession);
        }
      });
    }

    return _session;
  }

  async function getAccessToken() {
    const client = getClient();
    if (!client) return '';
    const { data } = await client.auth.getSession();
    return data?.session?.access_token || _session?.access_token || '';
  }

  async function signOut(redirectUrl = '/auth.html') {
    const client = getClient();
    _session = null;
    _user = null;
    if (client) {
      try {
        await client.auth.signOut();
      } catch (_) {}
    }
    redirectToAuth(redirectUrl);
  }

  function clearUserLocalCache(userId, storage) {
    const st = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!st || !userId) return;
    const keys = getUserScopedKeys(userId);
    Object.values(keys).forEach((k) => {
      try {
        st.removeItem(k);
      } catch (_) {}
    });
  }

  return {
    LEGACY_STORAGE_KEYS,
    sanitizeNextPath,
    getUserScopedKeys,
    isNeutralVagaEntry,
    storeEntryToDbRow,
    dbRowToStoreEntry,
    deriveUserIdentity,
    translateAuthError,
    detectLegacyLocalData,
    clearUserLocalCache,
    getClient,
    requireSession,
    getAccessToken,
    signOut,
    get session() {
      return _session;
    },
    get user() {
      return _user;
    }
  };
});
```

- [ ] **Step 4: Executar `npm test` para verificar que os novos testes passam**

Run: `npm test`
Expected: PASS com `✓ TODOS OS TESTES PASSARAM COM SUCESSO!`

- [ ] **Step 5: Commit da Task 1**

```powershell
git add schema_auth_supabase.sql auth_guard.js tests/auth_and_account.test.js tests/run_all_tests.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(auth): adiciona schema_auth_supabase.sql e nucleo isomorfico auth_guard.js" }
```

---

### Task 2: Endpoint Serverless `api/account.js`, Roteamento `servidor.js` & Build Config

**Files:**
- Create: `api/account.js`
- Modify: `servidor.js:22-67`
- Modify: `vercel.json`
- Modify: `.vercelignore`
- Modify: `scripts/build_dashboard.js`
- Modify: `tests/api_and_security.test.js`
- Modify: `tests/auth_and_account.test.js`

**Interfaces:**
- Consumes: `process.env.SUPABASE_URL`, `process.env.SUPABASE_SERVICE_ROLE_KEY`, `@supabase/supabase-js`.
- Produces (`api/account.js`):
  - `module.exports = async function handler(req, res)` (com suporte a `req._adminClient` opcional apenas para injeção determinística nos testes unitários)
  - `DELETE /api/account`: headers `Authorization: Bearer <jwt>`, `X-Confirm-Delete: EXCLUIR` (ou body `{ confirmation: "EXCLUIR" }`) -> `200 { ok: true, deletedUserId }` | `400` | `401` | `405` | `503`.

- [ ] **Step 1: Adicionar testes falhando para `api/account.js` e segurança de `servidor.js`**

Em `tests/api_and_security.test.js`, adicionar asserções de segurança logo abaixo da linha `assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, 'assets', 'dashboard_preview.png')), false, 'Deve permitir assets/');`:

```javascript
  assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, 'schema_auth_supabase.sql')), true, 'Deve bloquear schema_auth_supabase.sql');
  assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, 'docs', 'superpowers', 'specs', 'test.md')), true, 'Deve bloquear pasta docs/');
  assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, 'auth.html')), false, 'Deve permitir auth.html');
  assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, 'auth_guard.js')), false, 'Deve permitir auth_guard.js');
```

Em `tests/auth_and_account.test.js`, adicionar no topo `const accountHandler = require('../api/account');` e no final de `runAuthAndAccountTests()`:

```javascript
  // 7. Endpoint DELETE /api/account (CORS, 405, 401, 400 e 200 com exclusão em cascata)
  function mockRes() {
    return {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(p) { this.body = p; return this; },
      end(p) { this.body = p; return this; }
    };
  }

  const resOpt = mockRes();
  await accountHandler({ method: 'OPTIONS', headers: {} }, resOpt);
  assert.strictEqual(resOpt.statusCode, 204);

  const resGet = mockRes();
  await accountHandler({ method: 'GET', headers: {} }, resGet);
  assert.strictEqual(resGet.statusCode, 405);

  const resNoAuth = mockRes();
  await accountHandler({ method: 'DELETE', headers: {}, body: { confirmation: 'EXCLUIR' }, _adminClient: {} }, resNoAuth);
  assert.strictEqual(resNoAuth.statusCode, 401);

  let deletedUid = null;
  const fakeAdminClient = {
    auth: {
      async getUser(token) {
        if (token === 'valid-jwt') return { data: { user: { id: 'user-del-99' } }, error: null };
        return { data: { user: null }, error: { message: 'Invalid JWT' } };
      },
      admin: {
        async deleteUser(uid) {
          deletedUid = uid;
          return { data: {}, error: null };
        }
      }
    }
  };

  const resBadJwt = mockRes();
  await accountHandler({
    method: 'DELETE',
    headers: { authorization: 'Bearer wrong-jwt', 'x-confirm-delete': 'EXCLUIR' },
    _adminClient: fakeAdminClient
  }, resBadJwt);
  assert.strictEqual(resBadJwt.statusCode, 401);

  const resNoConfirm = mockRes();
  await accountHandler({
    method: 'DELETE',
    headers: { authorization: 'Bearer valid-jwt' },
    body: { confirmation: 'errado' },
    _adminClient: fakeAdminClient
  }, resNoConfirm);
  assert.strictEqual(resNoConfirm.statusCode, 400);

  const resOk = mockRes();
  await accountHandler({
    method: 'DELETE',
    headers: { authorization: 'Bearer valid-jwt', 'x-confirm-delete': 'EXCLUIR' },
    _adminClient: fakeAdminClient
  }, resOk);
  assert.strictEqual(resOk.statusCode, 200);
  assert.strictEqual(resOk.body.ok, true);
  assert.strictEqual(deletedUid, 'user-del-99');
  console.log('  ✓ Handler DELETE /api/account valida JWT, exige confirmação EXCLUIR e remove usuário');
```

- [ ] **Step 2: Executar `npm test` para confirmar que falha pela ausência de `api/account.js`**

Run: `npm test`
Expected: FAIL com `Cannot find module '../api/account'`

- [ ] **Step 3: Implementar `api/account.js` e atualizar `servidor.js`, `vercel.json`, `.vercelignore` e `scripts/build_dashboard.js`**

Criar `api/account.js`:

```javascript
const { createClient } = require('@supabase/supabase-js');

function getAdminClient(req) {
  if (req && req._adminClient) return req._adminClient;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Confirm-Delete');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Método não permitido. Use DELETE.' });
  }

  const adminClient = getAdminClient(req);
  if (!adminClient) {
    return res.status(503).json({
      error: 'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no servidor para excluir contas.'
    });
  }

  const authHeader = String(req.headers?.authorization || req.headers?.Authorization || '');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    return res.status(401).json({ error: 'Token de autenticação ausente.' });
  }

  const token = match[1].trim();
  const { data: userData, error: userErr } = await adminClient.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }

  const headerConfirm = String(req.headers?.['x-confirm-delete'] || req.headers?.['X-Confirm-Delete'] || '').trim();
  const bodyConfirm = String(req.body?.confirmation || '').trim();
  if (headerConfirm !== 'EXCLUIR' && bodyConfirm !== 'EXCLUIR') {
    return res.status(400).json({ error: 'Confirmação inválida. Digite EXCLUIR para remover a conta.' });
  }

  const uid = userData.user.id;
  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(uid);
  if (deleteErr) {
    return res.status(500).json({ error: `Falha ao excluir conta: ${deleteErr.message}` });
  }

  return res.status(200).json({ ok: true, deletedUserId: uid });
};
```

Em `servidor.js`, atualizar `BLOCKED_DIRS` e headers CORS:
- Trocar `const BLOCKED_DIRS = new Set(['api', 'etl', 'node_modules', 'scripts', 'src', 'tests', 'tests_py']);` por:
  `const BLOCKED_DIRS = new Set(['api', 'docs', 'etl', 'node_modules', 'scripts', 'src', 'tests', 'tests_py']);`
- Trocar `res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');` por:
  `res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');`
- Trocar `res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-LLM-Provider, X-LLM-Key, X-LLM-Model, X-GitHub-Token');` por:
  `res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Confirm-Delete, X-LLM-Provider, X-LLM-Key, X-LLM-Model, X-GitHub-Token');`

Atualizar `vercel.json`:

```json
{
  "version": 2,
  "buildCommand": "npm run build",
  "outputDirectory": "public",
  "functions": {
    "api/generate-resume.js": {
      "maxDuration": 60
    },
    "api/github-sync.js": {
      "maxDuration": 30
    },
    "api/parse-resume-pdf.js": {
      "maxDuration": 30
    },
    "api/account.js": {
      "maxDuration": 15
    }
  }
}
```

Em `.vercelignore`, adicionar ao final:

```text
docs/
schema_auth_supabase.sql
```

Atualizar `scripts/build_dashboard.js` para manter `index.html` sincronizado a partir de `dashboard.html` e copiar `auth.html`, `auth.css` e `auth_guard.js` para `public/`:

```javascript
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const outDir = path.join(rootDir, 'public');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Mantém index.html sempre idêntico a dashboard.html
const dashboardSrc = path.join(rootDir, 'dashboard.html');
const indexDest = path.join(rootDir, 'index.html');
if (fs.existsSync(dashboardSrc)) {
  fs.copyFileSync(dashboardSrc, indexDest);
}

const filesToCopy = [
  'index.html',
  'dashboard.html',
  'auth.html',
  'auth.css',
  'auth_guard.js',
  'design-system.css',
  'curriculo.html',
  'curriculo.css',
  'curriculo.js',
  'banco_vagas.js',
  'config_busca.js',
  'historico_execucoes.js',
  'regras_mismatch.js',
  'supabase_config.js',
  'favicon.svg'
];

filesToCopy.forEach(file => {
  const src = path.join(rootDir, file);
  const dest = path.join(outDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`✓ Copiado: ${file}`);
  }
});

const assetsSrc = path.join(rootDir, 'assets');
const assetsDest = path.join(outDir, 'assets');
if (fs.existsSync(assetsSrc)) {
  if (!fs.existsSync(assetsDest)) {
    fs.mkdirSync(assetsDest, { recursive: true });
  }
  fs.readdirSync(assetsSrc).forEach(file => {
    const s = path.join(assetsSrc, file);
    const d = path.join(assetsDest, file);
    if (fs.statSync(s).isFile()) {
      fs.copyFileSync(s, d);
    }
  });
  console.log('✓ Pasta assets copiada com sucesso');
}

console.log('🎉 Build estático concluído em /public com sucesso!');
```

- [ ] **Step 4: Executar `npm run build` e `npm test`**

Run: `npm run build; npm test`
Expected: PASS em todas as suítes (`✓ TODOS OS TESTES PASSARAM COM SUCESSO!`).

- [ ] **Step 5: Commit da Task 2**

```powershell
git add api/account.js servidor.js vercel.json .vercelignore scripts/build_dashboard.js public/ tests/api_and_security.test.js tests/auth_and_account.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(api): adiciona DELETE /api/account e atualiza roteamento e build" }
```

---

### Task 3: Superfície Dedicada de Autenticação (`auth.html` + `auth.css`)

**Files:**
- Create: `auth.css`
- Create: `auth.html`
- Modify: `tests/auth_and_account.test.js`

**Interfaces:**
- Consumes: `design-system.css`, `supabase_config.js`, `@supabase/supabase-js@2`, `window.SonaAuth` (`auth_guard.js`).
- Produces: `/auth.html` com suporte a:
  - Query params `?next=<path>`, `?mode=signup|reset`, `?deleted=1`, `?error=config`
  - Formulários `#form-signin`, `#form-signup`, `#form-recover`, `#form-reset` e botão `#btn-oauth-github`

- [ ] **Step 1: Adicionar testes falhando de conformidade de `auth.html` / `auth.css` em `tests/auth_and_account.test.js`**

Adicionar ao final de `runAuthAndAccountTests()` em `tests/auth_and_account.test.js`:

```javascript
  // 8. Conformidade de auth.html e auth.css com DESIGN.md (zero emojis, 4 modos, GitHub OAuth)
  const authHtmlPath = path.resolve(__dirname, '..', 'auth.html');
  const authCssPath = path.resolve(__dirname, '..', 'auth.css');
  assert.ok(fs.existsSync(authHtmlPath), 'auth.html deve existir na raiz');
  assert.ok(fs.existsSync(authCssPath), 'auth.css deve existir na raiz');

  const authHtml = fs.readFileSync(authHtmlPath, 'utf8');
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.strictEqual(emojiRegex.test(authHtml), false, 'auth.html não pode conter emojis (DESIGN.md)');
  ['form-signin', 'form-signup', 'form-recover', 'form-reset', 'btn-oauth-github', 'auth-feedback'].forEach((id) => {
    assert.ok(authHtml.includes(`id="${id}"`), `auth.html deve conter #${id}`);
  });
  console.log('  ✓ auth.html contém os 4 fluxos de autenticação e obedece estritamente ao DESIGN.md');
```

- [ ] **Step 2: Executar `npm test` para confirmar que falha pela ausência de `auth.html`**

Run: `npm test`
Expected: FAIL com `auth.html deve existir na raiz`

- [ ] **Step 3: Criar `auth.css` e `auth.html` e rodar `npm run build`**

Criar `auth.css`:

```css
/* =============================================================
   SONA AUTH SURFACE — OBSIDIAN DARK (DESIGN.md)
   Superfície única sem cards aninhados e sem emojis
   ============================================================= */

html, body {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  background: var(--bg-canvas);
  color: var(--text-primary);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

.auth-viewport {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.25rem;
  box-sizing: border-box;
}

.auth-surface {
  width: 100%;
  max-width: 416px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  padding: 2rem;
  box-sizing: border-box;
}

.auth-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--text-primary);
  text-decoration: none;
  margin-bottom: 1.5rem;
}

.auth-brand svg {
  width: 22px;
  height: 22px;
}

.auth-brand-name {
  font-size: 1.02rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.auth-title {
  margin: 0 0 0.35rem 0;
  font-size: 1.32rem;
  font-weight: 600;
  letter-spacing: -0.025em;
  color: var(--text-primary);
}

.auth-subtitle {
  margin: 0 0 1.35rem 0;
  font-size: 0.84rem;
  line-height: 1.45;
  color: var(--text-secondary);
}

.auth-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
  padding-bottom: 1.25rem;
  margin-bottom: 1.25rem;
  border-bottom: 1px solid var(--border-subtle);
}

.auth-tab {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 0.48rem 0.75rem;
  font-size: 0.82rem;
  font-weight: 500;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: color 0.14s ease, background 0.14s ease, border-color 0.14s ease;
}

.auth-tab:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.auth-tab.active {
  color: var(--text-primary);
  background: var(--bg-surface-elevated);
  border-color: var(--border-medium);
}

.auth-feedback {
  display: none;
  margin-bottom: 1rem;
  padding: 0.68rem 0.85rem;
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  line-height: 1.4;
  border: 1px solid var(--border-medium);
}

.auth-feedback.show {
  display: block;
}

.auth-feedback.error {
  background: var(--accent-rose-dim);
  border-color: rgba(248, 113, 113, 0.28);
  color: #FCA5A5;
}

.auth-feedback.success {
  background: var(--accent-green-dim);
  border-color: rgba(74, 222, 128, 0.28);
  color: #86EFAC;
}

.auth-form {
  display: none;
  flex-direction: column;
  gap: 0.95rem;
}

.auth-form.active {
  display: flex;
}

.auth-field {
  display: flex;
  flex-direction: column;
  gap: 0.38rem;
}

.auth-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.auth-label {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.auth-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.62rem 0.8rem;
  font-size: 0.85rem;
}

.auth-link-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--text-muted);
  font-size: 0.76rem;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: color 0.14s ease;
}

.auth-link-btn:hover {
  color: var(--text-primary);
}

.auth-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1.2rem 0;
  color: var(--text-faint);
  font-size: 0.74rem;
}

.auth-divider::before,
.auth-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}

.auth-submit-btn,
.auth-oauth-btn {
  width: 100%;
}
```

Criar `auth.html`:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#111114" />
  <title>Entrar — Sona</title>
  <link rel="icon" type="image/svg+xml" href="favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="design-system.css" />
  <link rel="stylesheet" href="auth.css" />
</head>
<body>
  <main class="auth-viewport">
    <section class="auth-surface" aria-labelledby="auth-heading">
      <div class="auth-brand">
        <svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
          <circle cx="50" cy="50" r="40" stroke="currentColor" stroke-width="9" opacity="0.28" />
          <path d="M50 10 A40 40 0 0 1 90 50" stroke="currentColor" stroke-width="9" stroke-linecap="round" />
        </svg>
        <span class="auth-brand-name">Sona</span>
      </div>

      <h1 class="auth-title" id="auth-heading">Entrar na Conta</h1>
      <p class="auth-subtitle" id="auth-subheading">
        Acesse seu painel individual de vagas, candidaturas e currículos ATS.
      </p>

      <div class="auth-tabs" id="auth-tabs-bar" role="tablist">
        <button type="button" class="auth-tab active" id="tab-signin" onclick="setAuthMode('signin')">
          Entrar
        </button>
        <button type="button" class="auth-tab" id="tab-signup" onclick="setAuthMode('signup')">
          Criar Conta
        </button>
      </div>

      <div class="auth-feedback" id="auth-feedback" role="status" aria-live="polite"></div>

      <!-- MODO 1: ENTRAR -->
      <form class="auth-form active" id="form-signin" onsubmit="handleSignIn(event)">
        <div class="auth-field">
          <label class="auth-label" for="signin-email">E-mail</label>
          <input class="sona-input auth-input" id="signin-email" type="email" autocomplete="email" placeholder="voce@exemplo.com" required />
        </div>
        <div class="auth-field">
          <div class="auth-label-row">
            <label class="auth-label" for="signin-password">Senha</label>
            <button type="button" class="auth-link-btn" onclick="setAuthMode('recover')">
              Esqueci Minha Senha
            </button>
          </div>
          <input class="sona-input auth-input" id="signin-password" type="password" autocomplete="current-password" placeholder="Sua senha" required />
        </div>
        <button type="submit" class="sona-btn-primary auth-submit-btn" id="btn-signin-submit">
          Entrar na Conta
        </button>
      </form>

      <!-- MODO 2: CRIAR CONTA -->
      <form class="auth-form" id="form-signup" onsubmit="handleSignUp(event)">
        <div class="auth-field">
          <label class="auth-label" for="signup-name">Nome de Exibição</label>
          <input class="sona-input auth-input" id="signup-name" type="text" autocomplete="name" placeholder="Seu nome completo" required />
        </div>
        <div class="auth-field">
          <label class="auth-label" for="signup-email">E-mail</label>
          <input class="sona-input auth-input" id="signup-email" type="email" autocomplete="email" placeholder="voce@exemplo.com" required />
        </div>
        <div class="auth-field">
          <label class="auth-label" for="signup-password">Senha (mínimo 8 caracteres)</label>
          <input class="sona-input auth-input" id="signup-password" type="password" autocomplete="new-password" minlength="8" placeholder="Crie uma senha forte" required />
        </div>
        <button type="submit" class="sona-btn-primary auth-submit-btn" id="btn-signup-submit">
          Criar Conta
        </button>
      </form>

      <!-- MODO 3: RECUPERAR SENHA -->
      <form class="auth-form" id="form-recover" onsubmit="handleRecoverPassword(event)">
        <div class="auth-field">
          <label class="auth-label" for="recover-email">E-mail da Conta</label>
          <input class="sona-input auth-input" id="recover-email" type="email" autocomplete="email" placeholder="voce@exemplo.com" required />
        </div>
        <button type="submit" class="sona-btn-primary auth-submit-btn" id="btn-recover-submit">
          Enviar Link de Recuperação
        </button>
        <button type="button" class="sona-btn-secondary auth-submit-btn" onclick="setAuthMode('signin')">
          Voltar para Login
        </button>
      </form>

      <!-- MODO 4: DEFINIR NOVA SENHA (PASSWORD_RECOVERY) -->
      <form class="auth-form" id="form-reset" onsubmit="handleUpdatePassword(event)">
        <div class="auth-field">
          <label class="auth-label" for="reset-password">Nova Senha (mínimo 8 caracteres)</label>
          <input class="sona-input auth-input" id="reset-password" type="password" autocomplete="new-password" minlength="8" placeholder="Digite a nova senha" required />
        </div>
        <div class="auth-field">
          <label class="auth-label" for="reset-password-confirm">Confirmar Nova Senha</label>
          <input class="sona-input auth-input" id="reset-password-confirm" type="password" autocomplete="new-password" minlength="8" placeholder="Repita a nova senha" required />
        </div>
        <button type="submit" class="sona-btn-primary auth-submit-btn" id="btn-reset-submit">
          Salvar Nova Senha
        </button>
      </form>

      <div id="oauth-section">
        <div class="auth-divider">ou continue com</div>
        <button type="button" class="sona-btn-secondary auth-oauth-btn" id="btn-oauth-github" onclick="handleGitHubOAuth()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
          </svg>
          <span>Continuar com GitHub</span>
        </button>
      </div>
    </section>
  </main>

  <script src="supabase_config.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="auth_guard.js"></script>
  <script>
    const params = new URLSearchParams(window.location.search);
    const nextPath = window.SonaAuth.sanitizeNextPath(params.get('next'), '/dashboard.html');
    let sb = null;
    let isRecoveryFlow = params.get('mode') === 'reset';

    function showFeedback(message, type = 'error') {
      const box = document.getElementById('auth-feedback');
      if (!box) return;
      box.textContent = message;
      box.className = `auth-feedback show ${type}`;
    }

    function clearFeedback() {
      const box = document.getElementById('auth-feedback');
      if (box) {
        box.textContent = '';
        box.className = 'auth-feedback';
      }
    }

    function setAuthMode(mode) {
      clearFeedback();
      const heading = document.getElementById('auth-heading');
      const subheading = document.getElementById('auth-subheading');
      const tabsBar = document.getElementById('auth-tabs-bar');
      const oauthSec = document.getElementById('oauth-section');

      ['signin', 'signup', 'recover', 'reset'].forEach((m) => {
        document.getElementById(`form-${m}`)?.classList.toggle('active', m === mode);
      });
      document.getElementById('tab-signin')?.classList.toggle('active', mode === 'signin');
      document.getElementById('tab-signup')?.classList.toggle('active', mode === 'signup');

      const showTabs = mode === 'signin' || mode === 'signup';
      if (tabsBar) tabsBar.style.display = showTabs ? 'grid' : 'none';
      if (oauthSec) oauthSec.style.display = showTabs ? 'block' : 'none';

      if (mode === 'signin') {
        heading.textContent = 'Entrar na Conta';
        subheading.textContent = 'Acesse seu painel individual de vagas, candidaturas e currículos ATS.';
      } else if (mode === 'signup') {
        heading.textContent = 'Criar Conta';
        subheading.textContent = 'Crie sua conta para salvar candidaturas, filtros e currículos na nuvem.';
      } else if (mode === 'recover') {
        heading.textContent = 'Recuperar Senha';
        subheading.textContent = 'Informe seu e-mail para receber o link seguro de redefinição.';
      } else if (mode === 'reset') {
        heading.textContent = 'Definir Nova Senha';
        subheading.textContent = 'Escolha uma nova senha para concluir a recuperação da sua conta.';
      }
    }

    async function initAuthPage() {
      const initialMode = params.get('mode');
      if (initialMode === 'signup' || initialMode === 'recover' || initialMode === 'reset') {
        setAuthMode(initialMode);
      }

      if (params.get('deleted') === '1') {
        showFeedback('Sua conta e todos os dados associados foram excluídos com segurança.', 'success');
      } else if (params.get('error') === 'config') {
        showFeedback('Configuração do Supabase ausente neste ambiente. Verifique supabase_config.js.', 'error');
        return;
      }

      sb = window.SonaAuth.getClient();
      if (!sb) {
        showFeedback('Cliente Supabase indisponível. Verifique sua conexão de rede.', 'error');
        return;
      }

      sb.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          isRecoveryFlow = true;
          setAuthMode('reset');
          return;
        }
        if (session?.user && !isRecoveryFlow) {
          window.location.replace(nextPath);
        }
      });

      const { data } = await sb.auth.getSession();
      if (data?.session?.user && !isRecoveryFlow) {
        window.location.replace(nextPath);
      }
    }

    async function handleSignIn(e) {
      e.preventDefault();
      if (!sb) return;
      clearFeedback();
      const btn = document.getElementById('btn-signin-submit');
      const email = document.getElementById('signin-email').value.trim();
      const password = document.getElementById('signin-password').value;

      btn.disabled = true;
      try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data?.session) {
          window.location.replace(nextPath);
        }
      } catch (err) {
        showFeedback(window.SonaAuth.translateAuthError(err), 'error');
      } finally {
        btn.disabled = false;
      }
    }

    async function handleSignUp(e) {
      e.preventDefault();
      if (!sb) return;
      clearFeedback();
      const btn = document.getElementById('btn-signup-submit');
      const fullName = document.getElementById('signup-name').value.trim();
      const email = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;

      if (password.length < 8) {
        showFeedback('A senha deve ter pelo menos 8 caracteres.', 'error');
        return;
      }

      btn.disabled = true;
      try {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: window.location.origin + nextPath
          }
        });
        if (error) throw error;
        if (data?.session) {
          window.location.replace(nextPath);
          return;
        }
        showFeedback('Cadastro criado. Verifique a caixa de entrada do seu e-mail para ativar a conta.', 'success');
      } catch (err) {
        showFeedback(window.SonaAuth.translateAuthError(err), 'error');
      } finally {
        btn.disabled = false;
      }
    }

    async function handleRecoverPassword(e) {
      e.preventDefault();
      if (!sb) return;
      clearFeedback();
      const btn = document.getElementById('btn-recover-submit');
      const email = document.getElementById('recover-email').value.trim();

      btn.disabled = true;
      try {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth.html?mode=reset`
        });
        if (error) throw error;
        showFeedback('Se o e-mail estiver cadastrado, enviamos um link seguro para redefinir sua senha.', 'success');
      } catch (err) {
        showFeedback(window.SonaAuth.translateAuthError(err), 'error');
      } finally {
        btn.disabled = false;
      }
    }

    async function handleUpdatePassword(e) {
      e.preventDefault();
      if (!sb) return;
      clearFeedback();
      const btn = document.getElementById('btn-reset-submit');
      const pw = document.getElementById('reset-password').value;
      const pwConfirm = document.getElementById('reset-password-confirm').value;

      if (pw.length < 8) {
        showFeedback('A nova senha deve ter pelo menos 8 caracteres.', 'error');
        return;
      }
      if (pw !== pwConfirm) {
        showFeedback('As senhas digitadas não coincidem.', 'error');
        return;
      }

      btn.disabled = true;
      try {
        const { error } = await sb.auth.updateUser({ password: pw });
        if (error) throw error;
        isRecoveryFlow = false;
        showFeedback('Senha atualizada com sucesso. Redirecionando para o painel...', 'success');
        setTimeout(() => window.location.replace(nextPath), 700);
      } catch (err) {
        showFeedback(window.SonaAuth.translateAuthError(err), 'error');
      } finally {
        btn.disabled = false;
      }
    }

    async function handleGitHubOAuth() {
      if (!sb) return;
      clearFeedback();
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'github',
        options: {
          scopes: 'read:user repo',
          redirectTo: `${window.location.origin}${nextPath}`
        }
      });
      if (error) {
        showFeedback(window.SonaAuth.translateAuthError(error), 'error');
      }
    }

    document.addEventListener('DOMContentLoaded', initAuthPage);
  </script>
</body>
</html>
```

- [ ] **Step 4: Executar `npm run build` e `npm test` para verificar a cópia em `public/` e aprovação dos testes**

Run: `npm run build; npm test`
Expected: PASS (`public/auth.html` e `public/auth.css` gerados e todos os testes verdes).

- [ ] **Step 5: Commit da Task 3**

```powershell
git add auth.html auth.css public/ tests/auth_and_account.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(auth): cria tela dedicada auth.html com login, cadastro, recuperacao e GitHub OAuth" }
```

---

### Task 4: Integração de Sessão & Isolamento por Usuário no Sona Resume Studio (`curriculo.html` + `curriculo.js`)

**Files:**
- Modify: `curriculo.html:1-50` & `curriculo.html:485-494`
- Modify: `curriculo.js:5-205`, `curriculo.js:270-460`, `curriculo.js:1350-1375`, `curriculo.js:1995-2030`
- Modify: `tests/auth_and_account.test.js`

**Interfaces:**
- Consumes: `window.SonaAuth` (`requireSession`, `getUserScopedKeys`, `signOut`, `getClient`).
- Produces:
  - Proteção anti-FOUC (`html.auth-pending`) em `curriculo.html`.
  - Isolamento de `PROFILE`, `HISTORY`, `BYOK_KEY` e `ACTIVE_JOB` por `currentUser.id`.
  - Sincronização de `byok_provider` e `byok_model` em `public.user_settings` mantendo `apiKey` apenas em `sona_byok_key_<uid>`.
  - Sincronização de leitura e escrita de `public.curriculos_gerados` ao abrir o Studio em novo dispositivo.

- [ ] **Step 1: Adicionar testes falhando para a integração do Studio em `tests/auth_and_account.test.js`**

Adicionar ao final de `runAuthAndAccountTests()` em `tests/auth_and_account.test.js`:

```javascript
  // 9. Integração de auth_guard.js e isolamento por usuário no Sona Resume Studio
  const curriculoHtml = fs.readFileSync(path.resolve(__dirname, '..', 'curriculo.html'), 'utf8');
  const curriculoJs = fs.readFileSync(path.resolve(__dirname, '..', 'curriculo.js'), 'utf8');

  assert.ok(curriculoHtml.includes('auth-pending'), 'curriculo.html deve iniciar com classe auth-pending anti-FOUC');
  assert.ok(curriculoHtml.includes('auth_guard.js'), 'curriculo.html deve carregar auth_guard.js');
  assert.ok(curriculoJs.includes('SonaAuth.requireSession'), 'curriculo.js deve exigir sessão autenticada via SonaAuth');
  assert.ok(curriculoJs.includes('SonaAuth.getUserScopedKeys'), 'curriculo.js deve escopar chaves locais por user_id');
  assert.ok(curriculoJs.includes('byok_provider'), 'curriculo.js deve sincronizar byok_provider em user_settings');
  assert.strictEqual(curriculoJs.includes('Modo Local-First'), false, 'curriculo.js não deve mais exibir modo anônimo Local-First');
  console.log('  ✓ curriculo.html e curriculo.js exigem sessão Supabase e isolam cache + BYOK por usuário');
```

- [ ] **Step 2: Executar `npm test` para confirmar que falha**

Run: `npm test`
Expected: FAIL com `curriculo.html deve iniciar com classe auth-pending anti-FOUC`

- [ ] **Step 3: Atualizar `curriculo.html` e `curriculo.js`**

Em `curriculo.html`:
1. Trocar `<html lang="pt-BR">` por `<html lang="pt-BR" class="auth-pending">` e adicionar dentro do `<head>` logo após `<link rel="stylesheet" href="curriculo.css" />`:
   ```html
   <style>html.auth-pending body { opacity: 0; pointer-events: none; }</style>
   ```
2. No card `#auth-card` (linhas 32–46), substituir pelos indicadores autenticados limpos:
   ```html
    <div class="auth-card" id="auth-card">
      <div class="auth-status-row">
        <span class="auth-dot" id="auth-dot"></span>
        <div style="min-width:0;">
          <div class="auth-name" id="auth-user-name">Conta Conectada</div>
          <div class="auth-mode" id="auth-mode-label">Sincronizado na nuvem</div>
        </div>
      </div>
      <button class="btn-secondary" id="btn-logout" style="width:100%; font-size:0.76rem; padding:0.42rem 0.65rem;" onclick="logoutSupabase()">
        Sair da Conta
      </button>
    </div>
   ```
3. No final do `<body>` (antes de `<script src="curriculo.js"></script>`), incluir `<script src="auth_guard.js"></script>`:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   <script src="supabase_config.js"></script>
   <script src="auth_guard.js"></script>
   <script src="curriculo.js"></script>
   ```

Em `curriculo.js`:
1. Substituir o bloco inicial de `STORAGE_KEYS` (linhas 5–18) por chaves dinâmicas baseadas no `currentUser.id` via `window.SonaAuth.getUserScopedKeys`:
   ```javascript
   let supabaseClient = null;
   let currentUser = null;
   let userCloudSettings = null;
   let githubOAuthToken = '';
   let activeJob = null;
   let currentResumeState = null;
   let masterProfile = createEmptyProfile();

   function getStudioStorageKeys() {
     return window.SonaAuth.getUserScopedKeys(currentUser?.id || 'anon');
   }
   ```
2. Em `initStudio()` (linhas 62–107), exigir `SonaAuth.requireSession()` **antes** de carregar dados locais ou de nuvem:
   ```javascript
     // 1.5 Exige sessão autenticada (SaaS fechado)
     const session = await window.SonaAuth.requireSession({
       onSessionUpdate: (newSession) => handleAuthSession(newSession)
     });
     if (!session) return;

     supabaseClient = window.SonaAuth.getClient();
     await handleAuthSession(session);
     loadLocalProfile();
     await Promise.all([pullCloudSettings(), pullCloudProfile(), pullCloudHistory()]);
     loadByokConfig();
   ```
3. Atualizar `handleAuthSession(session)`, `loginWithGitHub()` e `logoutSupabase()`:
   ```javascript
   async function handleAuthSession(session) {
     if (!session?.user) return;
     currentUser = session.user;
     githubOAuthToken = session.provider_token || '';
     const identity = window.SonaAuth.deriveUserIdentity(currentUser, userCloudSettings);
     const dot = document.getElementById('auth-dot');
     const nameEl = document.getElementById('auth-user-name');
     const modeEl = document.getElementById('auth-mode-label');

     if (dot) dot.classList.remove('local');
     if (nameEl) nameEl.textContent = identity.displayName;
     if (modeEl) modeEl.textContent = githubOAuthToken ? 'Supabase + GitHub OAuth' : 'Sincronizado na nuvem';

     const ghInput = document.getElementById('gh-username');
     if (ghInput && !ghInput.value && currentUser.user_metadata?.user_name) {
       ghInput.value = currentUser.user_metadata.user_name;
     }
   }

   async function loginWithGitHub() {
     if (!supabaseClient) return;
     const { error } = await supabaseClient.auth.signInWithOAuth({
       provider: 'github',
       options: {
         scopes: 'read:user repo',
         redirectTo: window.location.origin + window.location.pathname + window.location.search
       }
     });
     if (error) showToast(`Erro ao conectar GitHub: ${error.message}`);
   }

   async function logoutSupabase() {
     await window.SonaAuth.signOut('/auth.html');
   }
   ```
4. Adicionar `pullCloudSettings()` e atualizar `getByokConfig()` / `saveAndTestKey()` para ler/gravar `byok_provider` e `byok_model` em `user_settings` mantendo `apiKey` apenas em `getStudioStorageKeys().BYOK_KEY`:
   ```javascript
   async function pullCloudSettings() {
     if (!supabaseClient || !currentUser) return;
     const { data } = await supabaseClient
       .from('user_settings')
       .select('display_name, handle, avatar_url, daily_goal, byok_provider, byok_model')
       .eq('user_id', currentUser.id)
       .maybeSingle();
     if (data) {
       userCloudSettings = data;
       await handleAuthSession({ user: currentUser, provider_token: githubOAuthToken });
     }
   }

   function getByokConfig() {
     const keys = getStudioStorageKeys();
     let local = {};
     try {
       local = JSON.parse(localStorage.getItem(keys.BYOK_KEY) || '{}');
     } catch (_) {}
     return {
       provider: local.provider || userCloudSettings?.byok_provider || 'gemini',
       model: local.model || userCloudSettings?.byok_model || 'gemini-2.5-flash',
       apiKey: local.apiKey || ''
     };
   }
   ```
   E dentro de `saveAndTestKey()`, trocar `localStorage.setItem(STORAGE_KEYS.BYOK, JSON.stringify({ provider, model, apiKey }));` por:
   ```javascript
   localStorage.setItem(getStudioStorageKeys().BYOK_KEY, JSON.stringify({ provider, model, apiKey }));
   if (supabaseClient && currentUser) {
     supabaseClient.from('user_settings').upsert({
       user_id: currentUser.id,
       byok_provider: provider,
       byok_model: model
     }).then(() => {});
   }
   ```
5. Substituir todas as referências restantes a `STORAGE_KEYS.PROFILE`, `STORAGE_KEYS.HISTORY` e `STORAGE_KEYS.ACTIVE_JOB` em `curriculo.js` por `getStudioStorageKeys().PROFILE`, `getStudioStorageKeys().HISTORY` (com `pullCloudHistory()` buscando os 25 últimos registros de `curriculos_gerados` por `user_id`) e `getStudioStorageKeys().ACTIVE_JOB` (mantendo fallback de leitura em `'sona_active_resume_job'` se enviado na mesma aba).
   Adicionar `pullCloudHistory()` logo abaixo de `pullCloudProfile()`:
   ```javascript
   async function pullCloudHistory() {
     if (!supabaseClient || !currentUser) return;
     const { data, error } = await supabaseClient
       .from('curriculos_gerados')
       .select('*')
       .eq('user_id', currentUser.id)
       .order('created_at', { ascending: false })
       .limit(25);
     if (!error && Array.isArray(data) && data.length > 0) {
       localStorage.setItem(getStudioStorageKeys().HISTORY, JSON.stringify(data));
     }
   }
   ```

- [ ] **Step 4: Executar `npm run build` e `npm test`**

Run: `npm run build; npm test`
Expected: PASS em todas as suítes.

- [ ] **Step 5: Commit da Task 4**

```powershell
git add curriculo.html curriculo.js public/ tests/auth_and_account.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(studio): integra SonaAuth e isola perfil, historico e BYOK por user_id" }
```

---

### Task 5: Painel Principal Autenticado, Sincronização Individual & Tela 07 de Gerenciamento de Conta (`dashboard.html` + `index.html`)

**Files:**
- Modify: `dashboard.html:1-30`, `dashboard.html:2555-2573`, `dashboard.html:3180-3200`, `dashboard.html:3320-3655`, `dashboard.html:3875-3905`, `dashboard.html:4010-4212`, `dashboard.html:4770-4835`, `dashboard.html:5073-5115`, `dashboard.html:5585-5625`
- Modify: `index.html` (sincronizado automaticamente via `npm run build`)
- Modify: `tests/auth_and_account.test.js`

**Interfaces:**
- Consumes: `window.SonaAuth`, tabelas Supabase `user_settings` e `user_vagas`, endpoint `DELETE /api/account`.
- Produces:
  - Proteção `html.auth-pending` + `SonaAuth.requireSession()` no boot do painel.
  - Sincronização atômica por vaga `persistVagaState(canonicalKey)` (`upsert` ou `delete` em `public.user_vagas`) + fila offline `flushPendingVagasSync()`.
  - Meta diária configurável por usuário (`currentUserDailyGoal`) refletida na Tela 01 (`Meta do Dia`) e Tela 05 (`Insights`).
  - Card dinâmico do usuário na sidebar (`#sidebar-user-avatar`, `#sidebar-user-name`, `#sidebar-user-handle`) + `handleLogout()` real via `SonaAuth.signOut()`.
  - Tela 07 (`#screen-view-07`) completa com edição de perfil/meta, alteração de senha, exportação JSON, importação assistida de dados locais legados e exclusão de conta com confirmação `EXCLUIR`.

- [ ] **Step 1: Adicionar testes falhando para `dashboard.html` e Tela 07 em `tests/auth_and_account.test.js`**

Adicionar ao final de `runAuthAndAccountTests()` em `tests/auth_and_account.test.js`:

```javascript
  // 10. Integração de dashboard.html, Tela 07 (Configurações) e paridade com index.html e public/
  const dashHtml = fs.readFileSync(path.resolve(__dirname, '..', 'dashboard.html'), 'utf8');
  const indexHtml = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

  assert.strictEqual(dashHtml, indexHtml, 'index.html deve ser idêntico a dashboard.html');
  assert.ok(dashHtml.includes('auth-pending'), 'dashboard.html deve ter proteção anti-FOUC auth-pending');
  assert.ok(dashHtml.includes('auth_guard.js'), 'dashboard.html deve carregar auth_guard.js');
  assert.ok(dashHtml.includes('SonaAuth.requireSession'), 'dashboard.html deve exigir sessão via SonaAuth');
  assert.ok(dashHtml.includes("from('user_vagas')"), 'dashboard.html deve sincronizar vagas individuais em user_vagas');
  assert.ok(dashHtml.includes("from('user_settings')"), 'dashboard.html deve sincronizar conta e filtros em user_settings');

  // Verifica seções e IDs obrigatórios da Tela 07 (Configurações) e ausência do placeholder "Em breve"
  const screen07Match = dashHtml.match(/<section class="screen-view" id="screen-view-07">([\s\S]*?)<\/section>/);
  assert.ok(screen07Match, 'Seção #screen-view-07 deve existir em dashboard.html');
  const screen07Html = screen07Match[1];
  assert.strictEqual(screen07Html.includes('Em breve'), false, 'Tela 07 não deve mais conter placeholder Em breve');
  assert.strictEqual(emojiRegex.test(screen07Html), false, 'Tela 07 não pode conter emojis (DESIGN.md)');

  [
    'acc-display-name',
    'acc-handle',
    'acc-daily-goal',
    'acc-new-password',
    'acc-delete-confirm',
    'btn-export-account-data',
    'btn-delete-account'
  ].forEach((id) => {
    assert.ok(screen07Html.includes(`id="${id}"`), `Tela 07 deve conter controle #${id}`);
  });
  console.log('  ✓ dashboard.html implementa sincronização em user_vagas/user_settings e Tela 07 completa');
```

- [ ] **Step 2: Executar `npm test` para confirmar que falha**

Run: `npm test`
Expected: FAIL com `dashboard.html deve ter proteção anti-FOUC auth-pending`

- [ ] **Step 3: Implementar guard, sincronização na nuvem e Tela 07 em `dashboard.html`**

Aplicar as seguintes alterações em `dashboard.html`:

1. **Anti-FOUC & Inclusão de `auth_guard.js`:**
   - Trocar `<html lang="pt-BR">` na linha 2 por `<html lang="pt-BR" class="auth-pending">`.
   - Adicionar ao `<style>` principal: `html.auth-pending body { opacity: 0; pointer-events: none; }`.
   - Logo após `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`, incluir `<script src="auth_guard.js"></script>`.

2. **Card Dinâmico do Usuário na Sidebar (substituir bloco das linhas 2556–2571):**
   ```html
      <div class="user-footer-card" id="sidebar-user-card">
        <div class="user-avatar-circle" id="sidebar-user-avatar">--</div>
        <div class="user-details">
          <span class="user-name" id="sidebar-user-name">Carregando...</span>
          <span class="user-email" id="sidebar-user-handle">@conta</span>
        </div>
        <div class="user-actions">
          <button class="icon-action-btn logout" onclick="handleLogout()" title="Sair da Conta">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>
   ```

3. **Tela 07 — Gerenciamento de Conta (substituir `<section class="screen-view" id="screen-view-07">...</section>` nas linhas 3181–3199):**
   ```html
    <section class="screen-view" id="screen-view-07">
      <header class="screen-header-block">
        <div class="wrap">
          <h1 class="screen-title">Configurações da Conta</h1>
          <p class="screen-desc">
            Gerencie sua identidade, meta diária, segurança da sessão e portabilidade dos seus dados.
          </p>
        </div>
      </header>

      <div class="wrap" style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 760px; padding-bottom: 3rem;">
        <section style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 1.5rem;">
          <h2 style="font-size: 1rem; font-weight: 600; margin: 0 0 0.25rem 0; color: var(--text-primary);">Perfil e Operação</h2>
          <p style="font-size: 0.82rem; color: var(--text-secondary); margin: 0 0 1.25rem 0;">
            Essas informações personalizam seu painel e definem sua meta diária de candidaturas.
          </p>
          <form onsubmit="salvarConfiguracoesConta(event)" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem;">
            <div>
              <label style="display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.35rem;" for="acc-display-name">Nome de Exibição</label>
              <input class="sona-input" id="acc-display-name" type="text" style="width: 100%; padding: 0.58rem 0.75rem; box-sizing: border-box;" required />
            </div>
            <div>
              <label style="display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.35rem;" for="acc-handle">Identificador (@handle)</label>
              <input class="sona-input" id="acc-handle" type="text" style="width: 100%; padding: 0.58rem 0.75rem; box-sizing: border-box;" required />
            </div>
            <div>
              <label style="display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.35rem;" for="acc-daily-goal">Meta Diária de Candidaturas</label>
              <input class="sona-input" id="acc-daily-goal" type="number" min="1" max="50" style="width: 100%; padding: 0.58rem 0.75rem; box-sizing: border-box;" required />
            </div>
            <div style="grid-column: 1 / -1; display: flex; justify-content: flex-end; margin-top: 0.25rem;">
              <button type="submit" class="sona-btn-primary" id="btn-save-account-profile">Salvar Alterações</button>
            </div>
          </form>
        </section>

        <section style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 1.5rem;">
          <h2 style="font-size: 1rem; font-weight: 600; margin: 0 0 0.25rem 0; color: var(--text-primary);">Segurança e Sessão</h2>
          <p style="font-size: 0.82rem; color: var(--text-secondary); margin: 0 0 1rem 0;">
            Conectado como <strong id="acc-email-label" style="color: var(--text-primary);">--</strong> via <strong id="acc-provider-label" style="color: var(--text-primary);">--</strong>.
          </p>
          <form onsubmit="alterarSenhaConta(event)" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; align-items: end;">
            <div>
              <label style="display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.35rem;" for="acc-new-password">Nova Senha (mínimo 8 caracteres)</label>
              <input class="sona-input" id="acc-new-password" type="password" minlength="8" autocomplete="new-password" placeholder="Nova senha" style="width: 100%; padding: 0.58rem 0.75rem; box-sizing: border-box;" required />
            </div>
            <div>
              <label style="display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.35rem;" for="acc-confirm-password">Confirmar Nova Senha</label>
              <input class="sona-input" id="acc-confirm-password" type="password" minlength="8" autocomplete="new-password" placeholder="Repita a nova senha" style="width: 100%; padding: 0.58rem 0.75rem; box-sizing: border-box;" required />
            </div>
            <div style="grid-column: 1 / -1; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.25rem;">
              <button type="button" class="sona-btn-secondary" onclick="handleLogout()">Sair da Conta</button>
              <button type="submit" class="sona-btn-primary" id="btn-change-password">Alterar Senha</button>
            </div>
          </form>
        </section>

        <section id="legacy-migration-section" style="display: none; background: var(--bg-surface); border: 1px solid var(--border-medium); border-radius: var(--radius-lg); padding: 1.5rem;">
          <h2 style="font-size: 1rem; font-weight: 600; margin: 0 0 0.25rem 0; color: var(--text-primary);">Dados Locais Encontrados Neste Navegador</h2>
          <p id="legacy-migration-desc" style="font-size: 0.82rem; color: var(--text-secondary); margin: 0 0 1rem 0;">
            Encontramos registros salvos antes da ativação de contas individuais.
          </p>
          <button type="button" class="sona-btn-primary" id="btn-import-legacy-data" onclick="importarDadosLocaisLegados()">
            Importar Dados para Minha Conta
          </button>
        </section>

        <section style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 1.5rem;">
          <h2 style="font-size: 1rem; font-weight: 600; margin: 0 0 0.25rem 0; color: var(--text-primary);">Portabilidade e Exclusão de Conta</h2>
          <p style="font-size: 0.82rem; color: var(--text-secondary); margin: 0 0 1.15rem 0;">
            Exporte uma cópia JSON completa das suas informações ou remova permanentemente sua conta e todos os dados vinculados no Supabase.
          </p>
          <div style="display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1.35rem;">
            <button type="button" class="sona-btn-secondary" id="btn-export-account-data" onclick="exportarDadosConta()">
              Exportar Meus Dados
            </button>
          </div>
          <div style="border-top: 1px solid var(--border-subtle); padding-top: 1.15rem; display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; justify-content: space-between;">
            <div style="flex: 1; min-width: 220px;">
              <label style="display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 0.35rem;" for="acc-delete-confirm">
                Digite <strong>EXCLUIR</strong> para confirmar a remoção definitiva da conta
              </label>
              <input class="sona-input" id="acc-delete-confirm" type="text" placeholder="EXCLUIR" style="width: 100%; max-width: 240px; padding: 0.54rem 0.75rem; box-sizing: border-box;" />
            </div>
            <button type="button" class="sona-btn-secondary" id="btn-delete-account" onclick="excluirContaDefinitivamente()" style="color: #FCA5A5 !important; border-color: rgba(248, 113, 113, 0.32) !important;">
              Excluir Conta
            </button>
          </div>
        </section>
      </div>
    </section>
   ```

4. **Estado Escopado por Usuário, Sincronização em `user_vagas` / `user_settings` & Controladores da Tela 07:**
   - Substituir `STORAGE_KEY` e `PARAMS_KEY` fixos por helpers dinâmicos via `SonaAuth.getUserScopedKeys(authUser?.id)`:
     ```javascript
     let authUser = null;
     let userSettingsRow = null;
     let currentUserDailyGoal = 3;

     function getScopedKeys() {
       return window.SonaAuth.getUserScopedKeys(authUser?.id || 'anon');
     }

     function getUserStore() {
       try {
         const stored = localStorage.getItem(getScopedKeys().USER_STORE);
         return stored ? JSON.parse(stored) : {};
       } catch (_) {
         return {};
       }
     }

     function saveUserStore(store, changedKey = null) {
       try {
         localStorage.setItem(getScopedKeys().USER_STORE, JSON.stringify(store));
       } catch (_) {}
       if (changedKey) {
         persistVagaStateCloud(changedKey, store[changedKey]);
       }
     }
     ```
   - Nas 8 mutações de vaga (`iniciarInscricao`, `confirmarCandidaturaConcluida`, `marcarJaCandidatado`, `concluirAcaoPendente`, `moverDeVoltaParaAbertas`, `toggleStar`, `removerVagaEncerrada`, `descartarVagaMismatch`), passar `canonicalKey` como segundo argumento: `saveUserStore(store, canonicalKey);` (e em `abrirCurriculoStudio` / `iniciarInscricao`, gravar também em `getScopedKeys().ACTIVE_JOB`).
   - Implementar `persistVagaStateCloud(vagaKey, entry)` + `flushPendingVagasSync()`:
     ```javascript
     function markPendingVagaSync(vagaKey) {
       try {
         const key = getScopedKeys().PENDING_SYNC;
         const list = JSON.parse(localStorage.getItem(key) || '[]');
         if (!list.includes(vagaKey)) {
           list.push(vagaKey);
           localStorage.setItem(key, JSON.stringify(list));
         }
       } catch (_) {}
     }

     async function persistVagaStateCloud(vagaKey, entry) {
       const sb = window.SonaAuth.getClient();
       if (!sb || !authUser || !vagaKey) return;
       const job = allJobs.find((j) => j.canonicalKey === vagaKey);
       try {
         if (window.SonaAuth.isNeutralVagaEntry(entry)) {
           const { error } = await sb
             .from('user_vagas')
             .delete()
             .eq('user_id', authUser.id)
             .eq('vaga_key', vagaKey);
           if (error) throw error;
         } else {
           const row = window.SonaAuth.storeEntryToDbRow(authUser.id, vagaKey, entry, job?.id || null);
           const { error } = await sb.from('user_vagas').upsert(row, { onConflict: 'user_id,vaga_key' });
           if (error) throw error;
         }
       } catch (err) {
         console.warn('[Supabase] Falha ao sincronizar vaga individual, agendando reenvio:', err.message);
         markPendingVagaSync(vagaKey);
       }
     }

     async function flushPendingVagasSync() {
       const sb = window.SonaAuth.getClient();
       if (!sb || !authUser) return;
       const pendingKey = getScopedKeys().PENDING_SYNC;
       let list = [];
       try {
         list = JSON.parse(localStorage.getItem(pendingKey) || '[]');
       } catch (_) {}
       if (!list.length) return;
       const store = getUserStore();
       localStorage.removeItem(pendingKey);
       for (const vagaKey of list) {
         await persistVagaStateCloud(vagaKey, store[vagaKey]);
       }
     }
     ```
   - Implementar `carregarContaESincronizarSupabase()` chamado no `DOMContentLoaded` após `await window.SonaAuth.requireSession()`:
     - Carrega `user_settings` (criando linha inicial via `upsert` caso ainda não exista para contas pré-trigger) e `user_vagas` (`select('*').eq('user_id', authUser.id)`), reconstruindo `sona_user_store_<uid>` e `sona_params_<uid>`, atualizando `currentUserDailyGoal`, populando o card da sidebar + formulário da Tela 07 e verificando `SonaAuth.detectLegacyLocalData()` para exibir `#legacy-migration-section` quando aplicável.
   - Atualizar `salvarParametrosCrawler()` para gravar `localStorage.setItem(getScopedKeys().PARAMS, JSON.stringify(params))` e fazer `upsert` em `public.user_settings` (`{ user_id: authUser.id, crawler_params: params }`).
   - Substituir o número fixo `3` da meta diária em `renderScreen01()` e `renderScreen05()` por `currentUserDailyGoal` (padrão `3`).
   - Atualizar `carregarVagasSupabase()` e `carregarHistoricoSupabase()` para reutilizar `window.SonaAuth.getClient()` (enviando automaticamente o JWT autenticado exigido pela nova política RLS `to authenticated`).
   - Implementar `handleLogout()`, `salvarConfiguracoesConta(event)`, `alterarSenhaConta(event)`, `exportarDadosConta()`, `importarDadosLocaisLegados()` e `excluirContaDefinitivamente()` (chamando `DELETE /api/account` com `Authorization: Bearer <token>` e `X-Confirm-Delete: EXCLUIR`, limpando `SonaAuth.clearUserLocalCache(authUser.id)` e redirecionando para `/auth.html?deleted=1`).

- [ ] **Step 4: Executar `npm run build` e `npm test`**

Run: `npm run build; npm test`
Expected: PASS (`dashboard.html`, `index.html` e `public/*` sincronizados e todos os testes verdes).

- [ ] **Step 5: Commit da Task 5**

```powershell
git add dashboard.html index.html public/ tests/auth_and_account.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(dashboard): sincroniza vagas/filtros por conta e implementa gerenciamento de conta na Tela 07" }
```

---

### Task 6: Testes E2E Playwright (`tests_py/test_e2e_studio.py`), Documentação (`README.md`) & Verificação Final CI

**Files:**
- Modify: `tests_py/test_e2e_studio.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: `servidor.js` na porta `3917`, `auth.html`, `dashboard.html`, `curriculo.html`, interceptação de rede Playwright para `https://plmlmoytazwulxepyypr.supabase.co/**`.
- Produces:
  - Teste E2E validando redirecionamento anônimo (`/dashboard.html` e `/curriculo.html` -> `/auth.html`) e navegação entre modos `Entrar`, `Criar Conta` e `Recuperar Senha`.
  - Helper `_inject_authenticated_supabase_mock(context, base_url)` semeando sessão válida em `sb-plmlmoytazwulxepyypr-auth-token` e mockando endpoints REST/Auth do Supabase para que toda a suíte E2E existente rode autenticada ponta a ponta sem depender de credenciais externas na CI.

- [ ] **Step 1: Atualizar `tests_py/test_e2e_studio.py` com o teste de bloqueio anônimo + helper de sessão autenticada**

Em `tests_py/test_e2e_studio.py`:
1. Adicionar helper `_setup_supabase_auth_mock(context)` que:
   - Intercepta `https://*.supabase.co/auth/v1/**` respondendo `200` com um usuário de teste (`id: "00000000-0000-4000-8000-000000000001"`, `email: "joao@exemplo.com"`).
   - Intercepta `https://*.supabase.co/rest/v1/**` respondendo `200` (`[]` ou objeto `user_settings` mockado) para leituras/escritas PostgREST durante o E2E offline.
   - Injeta via `context.add_init_script` o token de sessão válido em `localStorage["sb-plmlmoytazwulxepyypr-auth-token"]` com `expires_at = int(time.time()) + 3600`.
2. Adicionar um novo teste E2E `test_auth_guard_redirects_anonymous_and_switches_modes(local_server)`:
   ```python
   def test_auth_guard_redirects_anonymous_and_switches_modes(local_server):
       with sync_playwright() as p:
           browser = _launch_browser(p)
           context = browser.new_context(viewport={"width": 1366, "height": 840})
           page = context.new_page()

           # Acesso sem login ao dashboard deve redirecionar imediatamente para /auth.html
           page.goto(f"{local_server}/dashboard.html", wait_until="domcontentloaded")
           page.wait_for_url("**/auth.html**")
           assert "/auth.html" in page.url

           # Alterna entre Entrar, Criar Conta e Recuperar Senha
           assert page.locator("#form-signin").is_visible()
           page.click("#tab-signup")
           assert page.locator("#form-signup").is_visible()
           page.click("#tab-signin")
           page.click("text=Esqueci Minha Senha")
           assert page.locator("#form-recover").is_visible()

           browser.close()
   ```
3. Chamar `_setup_supabase_auth_mock(context)` nos contextos dos testes E2E logados existentes em `tests_py/test_e2e_studio.py` e ajustar qualquer referência de `localStorage` do Studio para usar a chave escopada `sona_byok_key_00000000-0000-4000-8000-000000000001` / `sona_profile_00000000-0000-4000-8000-000000000001`.

- [ ] **Step 2: Atualizar `README.md` com o passo de provisionamento de `schema_auth_supabase.sql`**

Em `README.md` na seção `#### 2. Provisionar o Banco no Supabase`:
1. Listar o terceiro script SQL obrigatório:
   `3. [schema_auth_supabase.sql](schema_auth_supabase.sql) — tabelas user_settings e user_vagas, trigger automático on_auth_user_created e políticas RLS fechadas para usuários autenticados.`
2. Adicionar nota curta instruindo configurar em **Authentication -> URL Configuration** no painel do Supabase a `Site URL` e `Redirect URLs` (`http://127.0.0.1:3000/**` e domínio da Vercel) + provedor **GitHub** (opcional para OAuth).

- [ ] **Step 3: Executar toda a bateria de verificação local e CI**

Run:
```powershell
npm run build; npm test; pytest tests_py/test_etl_pipeline.py -v; npm run test:e2e; git diff --exit-code public/
```
Expected:
- `npm test` -> PASS
- `pytest tests_py/test_etl_pipeline.py -v` -> PASS
- `npm run test:e2e` -> PASS (incluindo o novo teste de redirecionamento `/auth.html` e todos os testes do Studio/Dashboard)
- `git diff --exit-code public/` -> código de saída `0` (zero arquivos fora de sincronia em `public/`).

- [ ] **Step 4: Commit final da Task 6**

```powershell
git add tests_py/test_e2e_studio.py README.md; if ($LASTEXITCODE -eq 0) { git commit -m "test(e2e): cobre guard de autenticacao no Playwright e documenta setup de Auth no README" }
```
