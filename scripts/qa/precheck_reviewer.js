#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const { AUTO_FIX_BRANCH_PREFIX } = require('./precheck_fixer');

const AI_REVIEWED_LABEL = 'ai-reviewed';

function isAutoFixPr(pr) {
  return String(pr && pr.headRefName || '').toLowerCase().startsWith(AUTO_FIX_BRANCH_PREFIX);
}

function hasAiReviewedLabel(pr) {
  const labels = (pr && pr.labels) || [];
  return labels.some((l) => (typeof l === 'string' ? l : l.name || '').toLowerCase() === AI_REVIEWED_LABEL);
}

function selectNextReviewablePr(openPrs, options = {}) {
  const reviewAllPrs = Boolean(options.reviewAllPrs);

  const candidates = (openPrs || [])
    .filter((pr) => !pr.isDraft)
    .filter((pr) => (reviewAllPrs ? true : isAutoFixPr(pr)))
    .filter((pr) => !hasAiReviewedLabel(pr))
    .sort((a, b) => {
      const dateA = Date.parse(a.createdAt || '') || 0;
      const dateB = Date.parse(b.createdAt || '') || 0;
      if (dateA !== dateB) return dateA - dateB;
      return Number(a.number) - Number(b.number);
    });

  if (candidates.length === 0) {
    return {
      eligible: false,
      reason: 'no_eligible_pr',
      pendingCount: 0,
      pr: null
    };
  }

  const chosen = candidates[0];
  return {
    eligible: true,
    reason: 'ready',
    pendingCount: candidates.length,
    pr: {
      number: chosen.number,
      title: chosen.title,
      headRefName: chosen.headRefName,
      url: chosen.url || ''
    }
  };
}

function defaultExecGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function evaluateReviewerPrecheck(options = {}) {
  const execGh = options.execGh || defaultExecGh;
  const reviewAllPrs = Boolean(
    options.reviewAllPrs || process.env.SONA_REVIEW_ALL_PRS === 'true'
  );

  const rawPrs = execGh([
    'pr', 'list',
    '--state', 'open',
    '--limit', '100',
    '--json', 'number,title,headRefName,labels,isDraft,url,createdAt'
  ]);
  const openPrs = JSON.parse(rawPrs || '[]');

  return selectNextReviewablePr(openPrs, { reviewAllPrs });
}

if (require.main === module) {
  try {
    const result = evaluateReviewerPrecheck();
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    process.exit(result.eligible ? 0 : 1);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

module.exports = {
  AI_REVIEWED_LABEL,
  isAutoFixPr,
  hasAiReviewedLabel,
  selectNextReviewablePr,
  evaluateReviewerPrecheck
};
