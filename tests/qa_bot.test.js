'use strict';

const assert = require('assert');
const {
  normalizeErrorText,
  buildFingerprint,
  sanitizeSeverity,
  formatIssueBody,
  findDuplicateIssue,
  reportQaBug,
  parseCliArgs
} = require('../scripts/qa/qa_issue');
const { findFreePort, stopQaServer } = require('../scripts/qa/qa_server');
const {
  slugifyTitle,
  getIssueSeverityRank,
  hasOpenPrForIssue,
  selectNextFixableIssue,
  evaluateFixerPrecheck
} = require('../scripts/qa/precheck_fixer');
const {
  isAutoFixPr,
  hasAiReviewedLabel,
  selectNextReviewablePr,
  evaluateReviewerPrecheck
} = require('../scripts/qa/precheck_reviewer');

async function runQaBotTests() {
  console.log('\n--- Testes do QA Bot (Fase 1: Fingerprint, Deduplicação & Server Helper) ---');

  // 1. Normalização ignora porta dinâmica, UUIDs e timestamps
  const n1 = normalizeErrorText('Error at http://127.0.0.1:51234/curriculo.html id 550e8400-e29b-41d4-a716-446655440000 2026-11-27T20:00:00Z');
  const n2 = normalizeErrorText('Error at http://127.0.0.1:60999/curriculo.html id 11111111-2222-3333-4444-555555555555 2026-12-01T08:30:12.123Z');
  assert.strictEqual(n1, n2, 'Normalização deveria gerar o mesmo texto para portas, UUIDs e timestamps diferentes');

  // 2. Fingerprint determinístico de 12 chars hex
  const fp1 = buildFingerprint({
    route: '/curriculo.html',
    category: 'console',
    summary: 'TypeError: Cannot read properties of null at http://127.0.0.1:40123/curriculo.js'
  });
  const fp2 = buildFingerprint({
    route: '/curriculo.html',
    category: 'console',
    summary: 'TypeError: Cannot read properties of null at http://127.0.0.1:59876/curriculo.js'
  });
  assert.strictEqual(fp1.length, 12, 'Fingerprint deve ter 12 caracteres');
  assert.strictEqual(fp1, fp2, 'Mesmo erro em portas locais distintas deve gerar o mesmo fingerprint');

  // 3. Sanitização de severidade
  assert.strictEqual(sanitizeSeverity('P0'), 'p0');
  assert.strictEqual(sanitizeSeverity('p2'), 'p2');
  assert.strictEqual(sanitizeSeverity('invalida'), 'p1');

  // 4. Formatação do corpo da issue contém marcador oculto de fingerprint
  const body = formatIssueBody({
    route: '/dashboard.html',
    category: 'visual',
    severity: 'p2',
    mission: 'Missão 1',
    summary: 'Overflow horizontal no mobile 390px',
    steps: '1. Abrir dashboard\n2. Redimensionar para 390x844',
    fingerprint: fp1
  });
  assert.ok(body.includes(`<!-- qa-fingerprint:${fp1} -->`), 'Corpo da issue deve conter o marcador de fingerprint');
  assert.ok(body.includes('`P2`'), 'Corpo da issue deve exibir severidade em caixa alta');

  // 5. Deduplicação encontra issue aberta existente
  const openIssues = [
    { number: 42, title: '[QA][P1] Outro erro', body: '<!-- qa-fingerprint:aaaaaaaaaaaa -->', url: 'https://github.com/org/repo/issues/42' },
    { number: 43, title: '[QA][P1] Erro alvo', body: `Detalhes...\n<!-- qa-fingerprint:${fp1} -->`, url: 'https://github.com/org/repo/issues/43' }
  ];
  const dup = findDuplicateIssue(openIssues, fp1);
  assert.ok(dup && dup.number === 43, 'findDuplicateIssue deveria localizar a issue #43');
  assert.strictEqual(findDuplicateIssue(openIssues, 'ffffffffffff'), null, 'Não deve encontrar duplicata inexistente');

  // 6. reportQaBug em modo dry-run não chama gh
  let ghCalled = false;
  const dryResult = reportQaBug(
    {
      title: 'Botão gerar trava sem erro',
      route: '/curriculo.html',
      category: 'functional',
      severity: 'p1',
      summary: 'Botão fica em loading infinito'
    },
    {
      dryRun: true,
      autoFix: true,
      execGh: () => {
        ghCalled = true;
        return '';
      }
    }
  );
  assert.strictEqual(ghCalled, false, 'Dry-run nunca deve executar gh');
  assert.strictEqual(dryResult.action, 'dry-run');
  assert.ok(dryResult.labels.includes('auto-fix'), 'Flag autoFix deve incluir label auto-fix');

  // 7. reportQaBug comenta em duplicata em vez de criar nova issue
  const calls = [];
  const fakeGhDup = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      return JSON.stringify([
        {
          number: 77,
          title: '[QA][P1] Crash ao filtrar',
          body: `<!-- qa-fingerprint:${buildFingerprint({ route: '/dashboard.html', category: 'console', summary: 'Crash ao filtrar' })} -->`,
          url: 'https://github.com/org/repo/issues/77'
        }
      ]);
    }
    return 'ok';
  };
  const dupRes = reportQaBug(
    {
      title: 'Crash ao filtrar',
      route: '/dashboard.html',
      category: 'console',
      severity: 'p1',
      summary: 'Crash ao filtrar'
    },
    { execGh: fakeGhDup }
  );
  assert.strictEqual(dupRes.action, 'commented');
  assert.strictEqual(dupRes.issueNumber, 77);
  assert.ok(
    calls.some((c) => c[0] === 'issue' && c[1] === 'comment' && c[2] === '77'),
    'Deveria comentar na issue duplicada #77'
  );
  assert.ok(
    !calls.some((c) => c[0] === 'issue' && c[1] === 'create'),
    'Não deveria criar issue nova quando há duplicata aberta'
  );

  // 8. reportQaBug cria nova issue quando não há duplicata
  const createCalls = [];
  const fakeGhCreate = (args) => {
    createCalls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/org/repo/issues/99\n';
    return '';
  };
  const createdRes = reportQaBug(
    {
      title: 'Erro 500 em fetch-jd',
      route: '/curriculo.html',
      category: 'network',
      severity: 'p1',
      summary: 'POST /api/fetch-jd retornou 500'
    },
    { execGh: fakeGhCreate }
  );
  assert.strictEqual(createdRes.action, 'created');
  assert.strictEqual(createdRes.url, 'https://github.com/org/repo/issues/99');
  assert.ok(createCalls.some((c) => c[0] === 'issue' && c[1] === 'create'));

  // 9. parseCliArgs e validações de qa_server
  const parsed = parseCliArgs(['--title', 'Bug X', '--dry-run', '--severity', 'p0']);
  assert.strictEqual(parsed.title, 'Bug X');
  assert.strictEqual(parsed['dry-run'], true);
  assert.strictEqual(parsed.severity, 'p0');

  const port = await findFreePort('127.0.0.1');
  assert.ok(Number.isInteger(port) && port > 0, 'findFreePort deve retornar porta válida');
  assert.throws(() => stopQaServer('abc'), /PID inválido/, 'stopQaServer deve rejeitar PID inválido');

  // --- Fase 2: Precheck & Seletor do Auto-Fixer ---
  assert.strictEqual(slugifyTitle('[QA][P0] Erro crítico na autenticação!'), 'erro-critico-na-autenticacao');
  assert.strictEqual(getIssueSeverityRank({ labels: [{ name: 'qa-severity:p0' }] }), 0);
  assert.strictEqual(getIssueSeverityRank({ labels: [{ name: 'qa-severity:p2' }] }), 2);
  assert.strictEqual(getIssueSeverityRank({ labels: [] }), 3);

  // Detecção de PR já aberto por branch ou por corpo (Closes #N)
  const samplePrs = [
    { number: 10, headRefName: 'fix/auto-12-overflow-mobile', title: 'fix', body: '' },
    { number: 11, headRefName: 'feat/manual-fix', title: 'fix', body: 'Closes #15' }
  ];
  assert.strictEqual(hasOpenPrForIssue(samplePrs, 12), true);
  assert.strictEqual(hasOpenPrForIssue(samplePrs, 15), true);
  assert.strictEqual(hasOpenPrForIssue(samplePrs, 99), false);

  // Teto de PRs automáticos (máximo 3) bloqueia novas execuções
  const threeAutoPrs = [
    { number: 1, headRefName: 'fix/auto-1-a', title: '', body: '' },
    { number: 2, headRefName: 'fix/auto-2-b', title: '', body: '' },
    { number: 3, headRefName: 'fix/auto-3-c', title: '', body: '' }
  ];
  const capped = selectNextFixableIssue(
    [{ number: 50, title: '[QA][P0] Crash', labels: [{ name: 'qa-severity:p0' }], createdAt: '2026-11-27T01:00:00Z' }],
    threeAutoPrs,
    3
  );
  assert.strictEqual(capped.eligible, false);
  assert.strictEqual(capped.reason, 'pr_cap_reached');

  // Priorização: ignora issue já com PR aberto e escolhe P0 antes de P1/P2
  const issuesQueue = [
    { number: 12, title: '[QA][P0] Já tem PR', labels: [{ name: 'qa-severity:p0' }], createdAt: '2026-11-27T01:00:00Z' },
    { number: 20, title: '[QA][P2] Layout', labels: [{ name: 'qa-severity:p2' }], createdAt: '2026-11-27T01:00:00Z' },
    { number: 21, title: '[QA][P0] Falha SSRF', labels: [{ name: 'qa-severity:p0' }], createdAt: '2026-11-27T02:00:00Z' }
  ];
  const picked = selectNextFixableIssue(issuesQueue, samplePrs, 3);
  assert.strictEqual(picked.eligible, true);
  assert.strictEqual(picked.issue.number, 21);
  assert.strictEqual(picked.issue.branchName, 'fix/auto-21-falha-ssrf');

  // evaluateFixerPrecheck com gh mockado (zero issues -> eligible: false)
  const emptyPrecheck = evaluateFixerPrecheck({
    execGh: () => '[]'
  });
  assert.strictEqual(emptyPrecheck.eligible, false);
  assert.strictEqual(emptyPrecheck.reason, 'no_eligible_issue');

  // --- Fase 3: Precheck & Seletor do PR Reviewer ---
  assert.strictEqual(isAutoFixPr({ headRefName: 'fix/auto-42-bug' }), true);
  assert.strictEqual(isAutoFixPr({ headRefName: 'feat/nova-tela' }), false);
  assert.strictEqual(hasAiReviewedLabel({ labels: [{ name: 'ai-reviewed' }] }), true);
  assert.strictEqual(hasAiReviewedLabel({ labels: [{ name: 'qa-bot' }] }), false);

  const reviewQueue = [
    { number: 1, headRefName: 'fix/auto-1-draft', isDraft: true, labels: [], createdAt: '2026-11-27T01:00:00Z' },
    { number: 2, headRefName: 'fix/auto-2-reviewed', isDraft: false, labels: [{ name: 'ai-reviewed' }], createdAt: '2026-11-27T02:00:00Z' },
    { number: 3, headRefName: 'feat/manual', isDraft: false, labels: [], createdAt: '2026-11-27T03:00:00Z' },
    { number: 4, headRefName: 'fix/auto-4-newer', isDraft: false, labels: [], createdAt: '2026-11-27T05:00:00Z' },
    { number: 5, headRefName: 'fix/auto-5-older', isDraft: false, labels: [], createdAt: '2026-11-27T04:00:00Z' }
  ];
  const revPick = selectNextReviewablePr(reviewQueue);
  assert.strictEqual(revPick.eligible, true);
  assert.strictEqual(revPick.pendingCount, 2);
  assert.strictEqual(revPick.pr.number, 5, 'Deve escolher o PR fix/auto-* mais antigo ainda sem ai-reviewed');

  const revAll = selectNextReviewablePr(reviewQueue, { reviewAllPrs: true });
  assert.strictEqual(revAll.pr.number, 3, 'Com reviewAllPrs=true deve incluir PR manual mais antigo');

  const emptyRev = evaluateReviewerPrecheck({ execGh: () => '[]' });
  assert.strictEqual(emptyRev.eligible, false);
  assert.strictEqual(emptyRev.reason, 'no_eligible_pr');

  console.log('✓ Todos os testes do QA Bot (Fases 1, 2 e 3) passaram!');
}

module.exports = { runQaBotTests };
