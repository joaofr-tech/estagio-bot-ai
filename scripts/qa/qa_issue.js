#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');

const VALID_SEVERITIES = new Set(['p0', 'p1', 'p2']);

const QA_LABELS = [
  { name: 'qa-bot', color: '5319E7', description: 'Bug encontrado pelo Bot QA Exploratório do Sona' },
  { name: 'auto-fix', color: '0E8A16', description: 'Autorizado para correção automática pelo Agente Fixer' },
  { name: 'ai-reviewed', color: '1D76DB', description: 'PR já revisado pelo Agente Revisor do Sona' },
  { name: 'qa-severity:p0', color: 'B60205', description: 'Severidade P0 — crítico / bloqueador / invariante de domínio' },
  { name: 'qa-severity:p1', color: 'D93F0B', description: 'Severidade P1 — fluxo principal quebrado ou erro 500' },
  { name: 'qa-severity:p2', color: 'FBCA04', description: 'Severidade P2 — bug visual, layout ou fluxo secundário' }
];

function normalizeErrorText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/127\.0\.0\.1:\d+/g, 'http://localhost')
    .replace(/https?:\/\/localhost:\d+/g, 'http://localhost')
    .replace(/\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}(\.\d+)?z?\b/g, '<ts>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFingerprint({ route, category, summary }) {
  const canonical = [
    normalizeErrorText(route || '/'),
    normalizeErrorText(category || 'functional'),
    normalizeErrorText(summary || '')
  ].join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

function sanitizeSeverity(severity) {
  const norm = String(severity || 'p1').toLowerCase().trim();
  return VALID_SEVERITIES.has(norm) ? norm : 'p1';
}

function formatIssueBody({
  route,
  category,
  severity,
  mission,
  summary,
  steps,
  expected,
  actual,
  consoleErrors,
  networkErrors,
  screenshotPath,
  fingerprint,
  reproducedCount = 2
}) {
  const sev = sanitizeSeverity(severity).toUpperCase();
  const lines = [
    `## Relatório Automático — Sona QA Explorer`,
    '',
    `- **Severidade:** \`${sev}\``,
    `- **Rota:** \`${route || '/'}\``,
    `- **Categoria:** \`${category || 'functional'}\``,
    `- **Missão:** ${mission || 'Exploração geral'}`,
    `- **Reproduzido:** ${reproducedCount}x consecutivas`,
    `- **Fingerprint:** \`${fingerprint}\``,
    '',
    '### Resumo',
    summary || 'Erro detectado durante navegação exploratória.',
    '',
    '### Passos para Reproduzir',
    steps || '1. Abrir a rota indicada\n2. Executar a interação descrita',
    '',
    '### Comportamento Esperado vs. Observado',
    `- **Esperado:** ${expected || 'Fluxo concluir sem erros de console, HTTP 5xx ou quebra visual.'}`,
    `- **Observado:** ${actual || summary || 'Falha reproduzida.'}`
  ];

  if (consoleErrors) {
    lines.push('', '### Console / Page Errors', '```text', String(consoleErrors).slice(0, 3000), '```');
  }
  if (networkErrors) {
    lines.push('', '### Network Errors (HTTP 4xx/5xx)', '```text', String(networkErrors).slice(0, 3000), '```');
  }
  if (screenshotPath) {
    lines.push('', '### Evidência Visual', `- Screenshot salvo localmente em: \`${screenshotPath}\``);
  }

  lines.push('', `<!-- qa-fingerprint:${fingerprint} -->`);
  return lines.join('\n');
}

function findDuplicateIssue(openIssues, fingerprint) {
  const marker = `<!-- qa-fingerprint:${fingerprint} -->`;
  return (openIssues || []).find((issue) => {
    const body = String(issue.body || '');
    return body.includes(marker) || body.includes(`\`${fingerprint}\``);
  }) || null;
}

function defaultExecGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function ensureLabels(execGh = defaultExecGh) {
  for (const label of QA_LABELS) {
    try {
      execGh([
        'label', 'create', label.name,
        '--color', label.color,
        '--description', label.description,
        '--force'
      ]);
    } catch {
      // Ignora erro se sem permissão para criar label; a criação da issue ainda tentará prosseguir.
    }
  }
}

function reportQaBug(bug, options = {}) {
  const execGh = options.execGh || defaultExecGh;
  const dryRun = Boolean(options.dryRun);
  const autoFix = Boolean(options.autoFix || process.env.SONA_QA_AUTO_FIX === 'true');

  if (!bug || !bug.title || !bug.summary) {
    throw new Error('Campos obrigatórios ausentes: title e summary.');
  }

  const severity = sanitizeSeverity(bug.severity);
  const fingerprint = buildFingerprint({
    route: bug.route,
    category: bug.category,
    summary: bug.summary
  });

  const body = formatIssueBody({ ...bug, severity, fingerprint });
  const labels = ['qa-bot', `qa-severity:${severity}`];
  if (autoFix) labels.push('auto-fix');

  if (dryRun) {
    return { action: 'dry-run', fingerprint, labels, title: bug.title, body };
  }

  ensureLabels(execGh);

  let openIssues = [];
  try {
    const raw = execGh([
      'issue', 'list',
      '--label', 'qa-bot',
      '--state', 'open',
      '--limit', '100',
      '--json', 'number,title,body,url'
    ]);
    openIssues = JSON.parse(raw || '[]');
  } catch {
    openIssues = [];
  }

  const duplicate = findDuplicateIssue(openIssues, fingerprint);
  if (duplicate) {
    const comment = [
      `Nova ocorrência confirmada pelo **Sona QA Explorer** (\`${new Date().toISOString()}\`).`,
      `- **Rota:** \`${bug.route || '/'}\``,
      `- **Fingerprint:** \`${fingerprint}\``,
      bug.consoleErrors ? `\n\`\`\`text\n${String(bug.consoleErrors).slice(0, 1200)}\n\`\`\`` : ''
    ].filter(Boolean).join('\n');

    execGh(['issue', 'comment', String(duplicate.number), '--body', comment]);
    return {
      action: 'commented',
      issueNumber: duplicate.number,
      url: duplicate.url || '',
      fingerprint
    };
  }

  const createArgs = [
    'issue', 'create',
    '--title', `[QA][${severity.toUpperCase()}] ${bug.title}`,
    '--body', body
  ];
  for (const label of labels) {
    createArgs.push('--label', label);
  }

  const url = execGh(createArgs).trim();
  return {
    action: 'created',
    url,
    fingerprint,
    labels
  };
}

function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

if (require.main === module) {
  try {
    const cli = parseCliArgs(process.argv.slice(2));
    if (cli['ensure-labels']) {
      ensureLabels();
      console.log(JSON.stringify({ ok: true, action: 'labels-ensured', count: QA_LABELS.length }));
      process.exit(0);
    }

    const result = reportQaBug(
      {
        title: cli.title,
        route: cli.route || '/',
        category: cli.category || 'functional',
        severity: cli.severity || 'p1',
        mission: cli.mission || '',
        summary: cli.summary,
        steps: cli.steps || '',
        expected: cli.expected || '',
        actual: cli.actual || '',
        consoleErrors: cli.console || '',
        networkErrors: cli.network || '',
        screenshotPath: cli.screenshot || ''
      },
      {
        dryRun: Boolean(cli['dry-run']),
        autoFix: Boolean(cli['auto-fix'])
      }
    );

    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

module.exports = {
  QA_LABELS,
  normalizeErrorText,
  buildFingerprint,
  sanitizeSeverity,
  formatIssueBody,
  findDuplicateIssue,
  ensureLabels,
  reportQaBug,
  parseCliArgs
};
