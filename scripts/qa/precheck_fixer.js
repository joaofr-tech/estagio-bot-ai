#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');

const DEFAULT_MAX_OPEN_AUTO_PRS = 3;
const AUTO_FIX_BRANCH_PREFIX = 'fix/auto-';

function slugifyTitle(title, maxLen = 40) {
  const cleaned = String(title || '')
    .replace(/^\[QA\](\[P[0-2]\])?\s*/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '');
  return cleaned || 'issue';
}

function getIssueSeverityRank(issue) {
  const names = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name || '').toLowerCase());
  if (names.includes('qa-severity:p0')) return 0;
  if (names.includes('qa-severity:p1')) return 1;
  if (names.includes('qa-severity:p2')) return 2;
  return 3;
}

function hasOpenPrForIssue(openPrs, issueNumber) {
  const num = Number(issueNumber);
  const branchPrefix = `${AUTO_FIX_BRANCH_PREFIX}${num}-`;
  const branchExact = `${AUTO_FIX_BRANCH_PREFIX}${num}`;
  const closePattern = new RegExp(`\\b(?:closes|fixes|resolves)\\s+#${num}\\b`, 'i');

  return (openPrs || []).some((pr) => {
    const head = String(pr.headRefName || '').toLowerCase();
    if (head === branchExact || head.startsWith(branchPrefix)) return true;
    const body = String(pr.body || '');
    const title = String(pr.title || '');
    return closePattern.test(body) || closePattern.test(title);
  });
}

function countOpenAutoFixPrs(openPrs) {
  return (openPrs || []).filter((pr) =>
    String(pr.headRefName || '').toLowerCase().startsWith(AUTO_FIX_BRANCH_PREFIX)
  ).length;
}

function selectNextFixableIssue(openIssues, openPrs, maxOpenAutoPrs = DEFAULT_MAX_OPEN_AUTO_PRS) {
  const openAutoPrCount = countOpenAutoFixPrs(openPrs);
  if (openAutoPrCount >= maxOpenAutoPrs) {
    return {
      eligible: false,
      reason: 'pr_cap_reached',
      openAutoPrCount,
      maxOpenAutoPrs,
      issue: null
    };
  }

  const candidates = (openIssues || [])
    .filter((issue) => !hasOpenPrForIssue(openPrs, issue.number))
    .sort((a, b) => {
      const rankDiff = getIssueSeverityRank(a) - getIssueSeverityRank(b);
      if (rankDiff !== 0) return rankDiff;
      const dateA = Date.parse(a.createdAt || '') || 0;
      const dateB = Date.parse(b.createdAt || '') || 0;
      if (dateA !== dateB) return dateA - dateB;
      return Number(a.number) - Number(b.number);
    });

  if (candidates.length === 0) {
    return {
      eligible: false,
      reason: 'no_eligible_issue',
      openAutoPrCount,
      maxOpenAutoPrs,
      issue: null
    };
  }

  const chosen = candidates[0];
  const branchName = `${AUTO_FIX_BRANCH_PREFIX}${chosen.number}-${slugifyTitle(chosen.title)}`;

  return {
    eligible: true,
    reason: 'ready',
    openAutoPrCount,
    maxOpenAutoPrs,
    issue: {
      number: chosen.number,
      title: chosen.title,
      url: chosen.url || '',
      severityRank: getIssueSeverityRank(chosen),
      branchName
    }
  };
}

function defaultExecGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function evaluateFixerPrecheck(options = {}) {
  const execGh = options.execGh || defaultExecGh;
  const maxOpenAutoPrs = Number(
    options.maxOpenAutoPrs || process.env.SONA_MAX_AUTO_PRS || DEFAULT_MAX_OPEN_AUTO_PRS
  );

  const rawPrs = execGh([
    'pr', 'list',
    '--state', 'open',
    '--limit', '100',
    '--json', 'number,headRefName,title,body,url'
  ]);
  const openPrs = JSON.parse(rawPrs || '[]');

  const rawIssues = execGh([
    'issue', 'list',
    '--label', 'auto-fix',
    '--state', 'open',
    '--limit', '100',
    '--json', 'number,title,labels,url,createdAt'
  ]);
  const openIssues = JSON.parse(rawIssues || '[]');

  return selectNextFixableIssue(openIssues, openPrs, maxOpenAutoPrs);
}

if (require.main === module) {
  try {
    const result = evaluateFixerPrecheck();
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    process.exit(result.eligible ? 0 : 1);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_MAX_OPEN_AUTO_PRS,
  AUTO_FIX_BRANCH_PREFIX,
  slugifyTitle,
  getIssueSeverityRank,
  hasOpenPrForIssue,
  countOpenAutoFixPrs,
  selectNextFixableIssue,
  evaluateFixerPrecheck
};
