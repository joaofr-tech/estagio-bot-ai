const assert = require('assert');
const path = require('path');

const { isSensitiveOrUnsafePath } = require('../servidor');
const generateResumeHandler = require('../api/generate-resume');
const githubSyncHandler = require('../api/github-sync');
const parseResumePdfHandler = require('../api/parse-resume-pdf');
const { extractJsonFromText, callLLMJson } = require('../api/_lib/llm');

function createMockRes() {
  const headers = {};
  const res = {
    statusCode: 200,
    headers,
    body: null,
    ended: false,
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end(payload) {
      if (payload !== undefined) this.body = payload;
      this.ended = true;
      return this;
    }
  };
  return res;
}

async function runApiAndSecurityTests() {
  console.log('\n--- Testes: Segurança Local, Endpoints Serverless (/api/*) & Adaptador LLM ---');

  // 1. Proteção contra dotfiles, arquivos sensíveis e directory traversal em servidor.js
  const rootDir = path.resolve(__dirname, '..');
  assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, '.env')), true, 'Deve bloquear .env');
  assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, '.git', 'config')), true, 'Deve bloquear .git');
  assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, 'email_config.json')), true, 'Deve bloquear email_config.json');
  assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, 'schema_supabase.sql')), true, 'Deve bloquear arquivos .sql');
  assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, 'api', '_lib', 'llm.js')), true, 'Deve bloquear pasta api/');
  assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, '..', 'Estagio_Bot_evil', 'secret.txt')), true, 'Deve bloquear traversal de diretório irmão');
  assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, 'dashboard.html')), false, 'Deve permitir dashboard.html');
  assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, 'curriculo.js')), false, 'Deve permitir curriculo.js');
  assert.strictEqual(isSensitiveOrUnsafePath(rootDir, path.resolve(rootDir, 'assets', 'dashboard_preview.png')), false, 'Deve permitir assets/');
  console.log('  ✓ Proteção do servidor local (dotfiles, arquivos sensíveis e path traversal)');

  // 2. Validação de método e entrada em /api/generate-resume
  {
    const resOpt = createMockRes();
    await generateResumeHandler({ method: 'OPTIONS', headers: {} }, resOpt);
    assert.strictEqual(resOpt.statusCode, 204);

    const resGet = createMockRes();
    await generateResumeHandler({ method: 'GET', headers: {} }, resGet);
    assert.strictEqual(resGet.statusCode, 405);

    const resNoProfile = createMockRes();
    await generateResumeHandler({ method: 'POST', headers: {}, body: { jdText: 'Estágio Python' } }, resNoProfile);
    assert.strictEqual(resNoProfile.statusCode, 400);

    const resNoJd = createMockRes();
    await generateResumeHandler({ method: 'POST', headers: {}, body: { profile: { basics: {} }, job: {}, jdText: '' } }, resNoJd);
    assert.strictEqual(resNoJd.statusCode, 400);
  }
  console.log('  ✓ Handler /api/generate-resume (CORS, 405 e validação 400)');

  // 3. Validação de /api/parse-resume-pdf
  {
    const resGet = createMockRes();
    await parseResumePdfHandler({ method: 'GET', headers: {} }, resGet);
    assert.strictEqual(resGet.statusCode, 405);

    const resShort = createMockRes();
    await parseResumePdfHandler({ method: 'POST', headers: {}, body: { text: 'curto' } }, resShort);
    assert.strictEqual(resShort.statusCode, 400);
  }
  console.log('  ✓ Handler /api/parse-resume-pdf (405 e texto mínimo)');

  // 4. Handler /api/github-sync (validação + classificação real vs ruído com fetch mockado)
  const originalFetch = global.fetch;
  try {
    const resMissing = createMockRes();
    await githubSyncHandler({ method: 'POST', headers: {}, body: { action: 'list' } }, resMissing);
    assert.strictEqual(resMissing.statusCode, 400);

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 1,
          name: 'Sona-ETL',
          full_name: 'dev/Sona-ETL',
          html_url: 'https://github.com/dev/Sona-ETL',
          description: 'Pipeline ETL em Python com Supabase e validação Pydantic',
          language: 'Python',
          topics: ['python', 'etl'],
          stargazers_count: 3,
          size: 400,
          fork: false,
          archived: false,
          is_template: false,
          pushed_at: new Date().toISOString(),
          owner: { login: 'dev' }
        },
        {
          id: 2,
          name: 'starter-template',
          full_name: 'dev/starter-template',
          html_url: 'https://github.com/dev/starter-template',
          description: '',
          language: 'JavaScript',
          topics: [],
          stargazers_count: 0,
          size: 10,
          fork: false,
          archived: false,
          is_template: true,
          pushed_at: new Date().toISOString(),
          owner: { login: 'dev' }
        }
      ]
    });

    const resList = createMockRes();
    await githubSyncHandler({ method: 'POST', headers: {}, body: { action: 'list', username: 'dev' } }, resList);
    assert.strictEqual(resList.statusCode, 200);
    assert.strictEqual(resList.body.ok, true);
    assert.strictEqual(resList.body.repos[0].name, 'Sona-ETL');
    assert.strictEqual(resList.body.repos[0].recommended, true);
    assert.strictEqual(resList.body.repos[1].recommended, false);
    assert.strictEqual(resList.body.repos[1].noise_reason, 'Template');
    console.log('  ✓ Handler /api/github-sync (ranqueamento e filtragem de templates)');

    // 5. Adaptador LLM: extração de JSON e fallback de modelo Gemini em 404
    assert.deepStrictEqual(extractJsonFromText('{"ok": true}'), { ok: true });
    assert.deepStrictEqual(extractJsonFromText('```json\n{"a": 1}\n```'), { a: 1 });
    assert.deepStrictEqual(extractJsonFromText('Aqui está: {"b": 2} fim.'), { b: 2 });
    assert.throws(() => extractJsonFromText('texto sem json'), /interpretar o JSON/);

    await assert.rejects(
      () => callLLMJson({ provider: 'gemini', apiKey: '', userPrompt: 'hi' }),
      /Chave de API/
    );
    await assert.rejects(
      () => callLLMJson({ provider: 'invalido', apiKey: 'k', userPrompt: 'hi' }),
      /não suportado/
    );

    const calledUrls = [];
    global.fetch = async (url) => {
      calledUrls.push(String(url));
      if (calledUrls.length === 1) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'Model not found or deprecated' } })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"ok": true, "fallback": true}' }] } }]
        })
      };
    };

    const llmRes = await callLLMJson({
      provider: 'gemini',
      apiKey: 'fake-key',
      userPrompt: 'teste'
    });
    assert.strictEqual(llmRes.fallback, true);
    assert.strictEqual(calledUrls.length, 2, 'Deve tentar fallback automático após 404 do modelo padrão');
    console.log('  ✓ Adaptador LLM (extração JSON, validação de erros e fallback Gemini)');
  } finally {
    global.fetch = originalFetch;
  }
}

module.exports = { runApiAndSecurityTests };
