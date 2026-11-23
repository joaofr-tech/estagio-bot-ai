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
  assert.strictEqual(SonaAuth.sanitizeNextPath('/\\evil.com'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('\\evil.com'), '/dashboard.html');
  assert.strictEqual(SonaAuth.sanitizeNextPath('/dashboard.html\u0000'), '/dashboard.html');
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
