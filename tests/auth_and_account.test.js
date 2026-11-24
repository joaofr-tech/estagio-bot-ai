const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SonaAuth = require('../auth_guard');
const accountHandler = require('../api/account');

async function runAuthAndAccountTests() {
  console.log('\n--- Testes: Autenticação Supabase, Isolamento por Usuário & Gerenciamento de Conta ---');

  // 1. Prevenção de Open Redirect em sanitizeNextPath
  assert.strictEqual(SonaAuth.sanitizeNextPath('/dashboard.html'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('/curriculo.html?view=profile'), '/curriculo.html?view=profile');
  assert.strictEqual(SonaAuth.sanitizeNextPath('https://evil.com/phish'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('//evil.com/phish'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('/\\evil.com'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('\\evil.com'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('/dashboard.html\u0000'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('javascript:alert(1)'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('/auth.html'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('/curriculo.html?embed=1&view=studio&vaga_id=123'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('/curriculo.html?view=studio&embed=1'), '/dashboard.html');
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
  assert.strictEqual(keysA.ACTIVE_JOB, 'sona_active_job_user-111');

  const mockStorageData = {
    [keysA.USER_STORE]: '{"a":1}',
    [keysA.PARAMS]: '{"b":2}',
    [keysA.PENDING_SYNC]: '[]',
    [keysA.PROFILE]: '{}',
    [keysA.HISTORY]: '[]',
    [keysA.BYOK_KEY]: '{"apiKey":"k1"}',
    [keysA.ACTIVE_JOB]: '{"id":"job-1"}',
    sona_active_resume_job: '{"id":"legacy-job"}',
    [keysB.USER_STORE]: '{"keep":true}'
  };
  const mockStorage = {
    removeItem(k) {
      delete mockStorageData[k];
    }
  };
  SonaAuth.clearUserLocalCache('user-111', mockStorage);
  Object.values(keysA).forEach((k) => {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(mockStorageData, k),
      false,
      `clearUserLocalCache deve remover ${k}`
    );
  });
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(mockStorageData, 'sona_active_resume_job'),
    false,
    'clearUserLocalCache deve remover sona_active_resume_job além das chaves escopadas por <uid>'
  );
  assert.strictEqual(
    mockStorageData[keysB.USER_STORE],
    '{"keep":true}',
    'clearUserLocalCache não deve afetar chaves de outra conta'
  );
  console.log('  ✓ getUserScopedKeys e clearUserLocalCache isolam e limpam o cache (incluindo sona_active_resume_job)');

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
  assert.ok(SonaAuth.translateAuthError('otp_expired').includes('expirou'));
  assert.ok(SonaAuth.translateAuthError('Email link is invalid or has expired').includes('expirou'));
  assert.ok(SonaAuth.translateAuthError('Auth session missing!').includes('Sessão de recuperação'));
  assert.ok(SonaAuth.translateAuthError('access_denied').includes('cancelada'));
  assert.ok(SonaAuth.translateAuthError('The user denied your request').includes('cancelada'));
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

  // 6. Validação estrutural de schema_supabase.sql e schema_auth_supabase.sql
  const baseSqlPath = path.resolve(__dirname, '..', 'schema_supabase.sql');
  const baseSql = fs.readFileSync(baseSqlPath, 'utf8');
  assert.strictEqual(
    baseSql.includes('create policy "Permitir leitura publica'),
    false,
    'schema_supabase.sql não pode criar política de leitura pública anônima'
  );
  assert.ok(
    baseSql.includes('to authenticated'),
    'schema_supabase.sql deve restringir políticas SELECT a authenticated'
  );
  assert.ok(
    baseSql.includes('create policy "Permitir leitura autenticada de vagas"') &&
      baseSql.includes('create policy "Permitir leitura autenticada do historico"'),
    'schema_supabase.sql deve criar políticas de leitura autenticada para vagas e historico_execucoes'
  );

  const sqlPath = path.resolve(__dirname, '..', 'schema_auth_supabase.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.ok(sql.includes('create table if not exists public.user_settings'), 'Deve criar user_settings');
  assert.ok(sql.includes('create table if not exists public.user_vagas'), 'Deve criar user_vagas');
  assert.ok(sql.includes('on_auth_user_created'), 'Deve criar trigger on_auth_user_created');
  assert.ok(sql.includes('to authenticated'), 'Deve restringir leitura de vagas a authenticated');
  console.log('  ✓ schema_supabase.sql e schema_auth_supabase.sql impõem políticas RLS autenticadas');

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

  // 8. Conformidade de auth.html e auth.css com DESIGN.md (zero emojis, 4 modos, GitHub OAuth)
  const authHtmlPath = path.resolve(__dirname, '..', 'auth.html');
  const authCssPath = path.resolve(__dirname, '..', 'auth.css');
  assert.ok(fs.existsSync(authHtmlPath), 'auth.html deve existir na raiz');
  assert.ok(fs.existsSync(authCssPath), 'auth.css deve existir na raiz');

  const authHtml = fs.readFileSync(authHtmlPath, 'utf8');
  const authCss = fs.readFileSync(authCssPath, 'utf8');
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.strictEqual(emojiRegex.test(authHtml), false, 'auth.html não pode conter emojis (DESIGN.md)');
  assert.strictEqual(emojiRegex.test(authCss), false, 'auth.css não pode conter emojis (DESIGN.md)');
  ['form-signin', 'form-signup', 'form-recover', 'form-reset', 'btn-oauth-github', 'auth-feedback'].forEach((id) => {
    assert.ok(authHtml.includes(`id="${id}"`), `auth.html deve conter #${id}`);
  });
  const resetFormMatch = authHtml.match(/<form[^>]*id="form-reset"[\s\S]*?<\/form>/);
  assert.ok(resetFormMatch, 'auth.html deve conter o bloco <form id="form-reset">');
  assert.ok(
    resetFormMatch[0].includes('Voltar para Login') && resetFormMatch[0].includes("setAuthMode('signin')"),
    '#form-reset deve incluir botão Voltar para Login'
  );
  assert.ok(authHtml.includes("type') === 'recovery'"), "auth.html deve detectar type === 'recovery' na URL/hash");
  assert.ok(authHtml.includes('window.location.hash'), 'auth.html deve inspecionar window.location.hash no startup');
  assert.ok(
    authHtml.includes('error_description') && authHtml.includes('error_code'),
    'auth.html deve exibir erros de callback OAuth/OTP'
  );
  console.log('  ✓ auth.html contém os 4 fluxos de autenticação e obedece estritamente ao DESIGN.md');

  // 9. Integração de auth_guard.js e isolamento por usuário no Sona Resume Studio
  const curriculoHtml = fs.readFileSync(path.resolve(__dirname, '..', 'curriculo.html'), 'utf8');
  const curriculoJs = fs.readFileSync(path.resolve(__dirname, '..', 'curriculo.js'), 'utf8');

  assert.ok(curriculoHtml.includes('auth-pending'), 'curriculo.html deve iniciar com classe auth-pending anti-FOUC');
  assert.ok(
    curriculoHtml.includes('html.auth-pending { background: #111114; }'),
    'curriculo.html deve aplicar background #111114 em html.auth-pending'
  );
  assert.ok(curriculoHtml.includes('auth_guard.js'), 'curriculo.html deve carregar auth_guard.js');
  assert.strictEqual(curriculoHtml.includes('Armazenamento local'), false, 'curriculo.html não deve mais exibir Armazenamento local');
  assert.strictEqual(emojiRegex.test(curriculoHtml), false, 'curriculo.html não pode conter emojis (DESIGN.md)');
  assert.ok(curriculoJs.includes('SonaAuth.requireSession'), 'curriculo.js deve exigir sessão autenticada via SonaAuth');
  assert.ok(curriculoJs.includes('SonaAuth.getUserScopedKeys'), 'curriculo.js deve escopar chaves locais por user_id');
  assert.ok(curriculoJs.includes('byok_provider'), 'curriculo.js deve sincronizar byok_provider em user_settings');
  assert.ok(curriculoJs.includes('pullCloudHistory'), 'curriculo.js deve puxar histórico de currículos gerados da nuvem');
  assert.strictEqual(curriculoJs.includes('STORAGE_KEYS'), false, 'curriculo.js não deve mais conter referências a STORAGE_KEYS');
  assert.strictEqual(curriculoJs.includes('Modo Local-First'), false, 'curriculo.js não deve mais exibir modo anônimo Local-First');
  assert.strictEqual(
    curriculoJs.includes('sona_active_resume_job'),
    false,
    'curriculo.js não deve conter fallback para sona_active_resume_job'
  );
  assert.ok(
    curriculoJs.includes("keyEl.value = cfg.apiKey || ''"),
    'curriculo.js deve limpar #byok-key quando a nova sessão não tiver apiKey local'
  );
  assert.ok(
    curriculoJs.includes("if (ghEl) ghEl.value = ''"),
    'curriculo.js deve limpar #gh-username durante troca de sessão ao vivo'
  );
  console.log('  ✓ curriculo.html e curriculo.js exigem sessão Supabase e isolam cache + BYOK por usuário');

  // 10. Integração de dashboard.html, Tela 07 (Configurações) e paridade com index.html e public/
  const dashHtml = fs.readFileSync(path.resolve(__dirname, '..', 'dashboard.html'), 'utf8');
  const indexHtml = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const pubDashHtml = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  const pubIndexHtml = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'index.html'), 'utf8');
  const authGuardSrc = fs.readFileSync(path.resolve(__dirname, '..', 'auth_guard.js'), 'utf8');
  const pubAuthGuardSrc = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'auth_guard.js'), 'utf8');

  assert.strictEqual(dashHtml, indexHtml, 'index.html deve ser idêntico a dashboard.html');
  assert.ok(dashHtml.includes('auth-pending'), 'dashboard.html deve ter proteção anti-FOUC auth-pending');
  assert.strictEqual(dashHtml, pubDashHtml, 'public/dashboard.html deve estar sincronizado com dashboard.html');
  assert.strictEqual(dashHtml, pubIndexHtml, 'public/index.html deve estar sincronizado com dashboard.html');
  assert.strictEqual(authGuardSrc, pubAuthGuardSrc, 'public/auth_guard.js deve estar sincronizado com auth_guard.js');
  assert.ok(
    authGuardSrc.includes('_signingOutRedirect'),
    'auth_guard.js deve preservar redirectUrl customizado (/auth.html?deleted=1) durante SIGNED_OUT'
  );
  assert.ok(dashHtml.includes('auth_guard.js'), 'dashboard.html deve carregar auth_guard.js');
  assert.ok(dashHtml.includes('SonaAuth.requireSession'), 'dashboard.html deve exigir sessão via SonaAuth');
  assert.ok(dashHtml.includes("from('user_vagas')"), 'dashboard.html deve sincronizar vagas individuais em user_vagas');
  assert.ok(dashHtml.includes("from('user_settings')"), 'dashboard.html deve sincronizar conta e filtros em user_settings');
  assert.strictEqual(dashHtml.includes("const STORAGE_KEY = 'estagios_user_store'"), false, 'dashboard.html não deve usar STORAGE_KEY global fixa');
  assert.strictEqual(dashHtml.includes("const PARAMS_KEY = 'estagios_crawler_params'"), false, 'dashboard.html não deve usar PARAMS_KEY global fixa');
  assert.strictEqual(dashHtml.includes("localStorage.removeItem('sb_auth_token')"), false, 'handleLogout não deve usar mock sb_auth_token');
  assert.strictEqual(
    dashHtml.includes("localStorage.setItem('sona_active_resume_job'"),
    false,
    'dashboard.html não deve gravar chave não-escopada sona_active_resume_job'
  );
  assert.ok(dashHtml.includes('currentUserDailyGoal'), 'dashboard.html deve usar currentUserDailyGoal dinâmico');
  assert.ok(dashHtml.includes('persistVagaStateCloud'), 'dashboard.html deve sincronizar mutações unitárias na nuvem');
  assert.ok(dashHtml.includes('flushPendingVagasSync'), 'dashboard.html deve reenviar fila offline pendente');
  assert.ok(dashHtml.includes('/api/account'), 'dashboard.html deve chamar DELETE /api/account na exclusão de conta');
  assert.ok(dashHtml.includes('clearUserLocalCache'), 'dashboard.html deve limpar cache local do usuário ao excluir conta');

  ['sidebar-user-card', 'sidebar-user-avatar', 'sidebar-user-name', 'sidebar-user-handle'].forEach((id) => {
    assert.ok(dashHtml.includes(`id="${id}"`), `Sidebar deve conter #${id}`);
  });

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
    'acc-email-label',
    'acc-provider-label',
    'acc-new-password',
    'acc-confirm-password',
    'acc-delete-confirm',
    'legacy-migration-section',
    'btn-import-legacy-data',
    'btn-export-account-data',
    'btn-delete-account'
  ].forEach((id) => {
    assert.ok(screen07Html.includes(`id="${id}"`), `Tela 07 deve conter controle #${id}`);
  });
  console.log('  ✓ dashboard.html implementa sincronização em user_vagas/user_settings e Tela 07 completa');
}

module.exports = { runAuthAndAccountTests };
