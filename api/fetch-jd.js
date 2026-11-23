/**
 * Vercel Serverless Function: POST /api/fetch-jd
 * Busca e extrai a descrição completa de uma vaga a partir da URL (Ashby, Lever, Greenhouse,
 * Gupy, LinkedIn Guest API, JSON-LD JobPosting ou HTML genérico), com proteção contra SSRF
 * e sanitização contra prompt injection.
 */

const { sanitizeJobDescription } = require('./_lib/resume_engine');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function isPrivateOrUnsafeHost(hostname = '') {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  // IPv4 privados / link-local / metadata cloud
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

function validateExternalUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return { valid: false, error: 'URL inválida.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Apenas URLs http:// ou https:// são permitidas.' };
  }
  if (isPrivateOrUnsafeHost(parsed.hostname)) {
    return { valid: false, error: 'Host interno ou privado bloqueado por segurança (SSRF).' };
  }
  if (/vertexaisearch\.cloud\.google\.com|grounding-api-redirect/i.test(parsed.href)) {
    return { valid: false, error: 'Link temporário de grounding redirect não suportado.' };
  }
  return { valid: true, parsed };
}

function htmlToText(markup = '') {
  return String(markup || '')
    .replace(/<(script|style|noscript|svg|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/?(p|div|br|ul|ol|h[1-6]|tr|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function identifySource(parsed) {
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (host === 'jobs.ashbyhq.com' && parts.length >= 2) {
    return { source: 'ashby', org: parts[0], jobId: parts[1] };
  }
  if ((host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') && parts.length >= 2) {
    return { source: 'lever', org: parts[0], jobId: parts[1] };
  }
  if (host.endsWith('greenhouse.io') && parts.includes('jobs')) {
    const idx = parts.indexOf('jobs');
    if (idx >= 1 && idx + 1 < parts.length) {
      return { source: 'greenhouse', org: parts[idx - 1], jobId: parts[idx + 1] };
    }
  }
  if (host.endsWith('.gupy.io') && parts.includes('jobs')) {
    const idx = parts.indexOf('jobs');
    if (idx + 1 < parts.length) {
      return { source: 'gupy', org: host.split('.')[0], jobId: parts[idx + 1] };
    }
  }
  if (host.includes('linkedin.com') && parts.includes('view')) {
    const m = parsed.pathname.match(/(\d{8,12})/);
    if (m) return { source: 'linkedin', org: 'linkedin', jobId: m[1] };
  }
  return { source: 'web', org: host, jobId: '' };
}

function extractJsonLdJob(html = '') {
  const rx = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = rx.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length > 0) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        const t = node['@type'];
        if ((typeof t === 'string' && t.toLowerCase() === 'jobposting') || (Array.isArray(t) && t.some((x) => String(x).toLowerCase() === 'jobposting'))) {
          return node;
        }
        if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
      }
    } catch {
      // ignora bloco inválido
    }
  }
  return null;
}

async function fetchTextOrJson(url, accept = 'application/json') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: accept,
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8'
      }
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ao consultar ${url}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJobPosting(rawUrl) {
  const check = validateExternalUrl(rawUrl);
  if (!check.valid) {
    const err = new Error(check.error);
    err.statusCode = 400;
    throw err;
  }

  const { parsed } = check;
  const info = identifySource(parsed);
  let posting = { url: parsed.href, source: info.source, company: '', title: '', location: '', workplace: '', compensation: '', description: '' };

  if (info.source === 'ashby') {
    const data = JSON.parse(await fetchTextOrJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(info.org)}?includeCompensation=true`));
    const job = (data.jobs || []).find((j) => String(j.id) === String(info.jobId));
    if (!job) throw new Error('Vaga Ashby não encontrada no board público (pode estar encerrada).');
    posting = {
      ...posting,
      company: info.org,
      title: job.title || '',
      location: job.location || '',
      workplace: job.workplaceType || (job.isRemote ? 'Remote' : ''),
      compensation: job.compensation?.compensationTierSummary || '',
      description: job.descriptionPlain || htmlToText(job.descriptionHtml || '')
    };
  } else if (info.source === 'lever') {
    const job = JSON.parse(await fetchTextOrJson(`https://api.lever.co/v0/postings/${encodeURIComponent(info.org)}/${encodeURIComponent(info.jobId)}?mode=json`));
    const sections = [job.descriptionPlain || ''];
    for (const block of job.lists || []) {
      sections.push(`${block.text || ''}\n${htmlToText(block.content || '')}`);
    }
    sections.push(job.additionalPlain || '');
    posting = {
      ...posting,
      company: info.org,
      title: job.text || '',
      location: job.categories?.location || '',
      workplace: job.workplaceType || '',
      description: sections.map((s) => s.trim()).filter(Boolean).join('\n\n')
    };
  } else if (info.source === 'greenhouse') {
    const job = JSON.parse(await fetchTextOrJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(info.org)}/jobs/${encodeURIComponent(info.jobId)}`));
    posting = {
      ...posting,
      company: info.org,
      title: job.title || '',
      location: job.location?.name || '',
      description: htmlToText(job.content || '')
    };
  } else if (info.source === 'linkedin') {
    const html = await fetchTextOrJson(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${info.jobId}`, 'text/html');
    const titleM = html.match(/<h2[^>]*top-card-layout__title[^>]*>([\s\S]*?)<\/h2>/i);
    const compM = html.match(/topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/i);
    const descM = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/i);
    posting = {
      ...posting,
      company: compM ? htmlToText(compM[1]) : '',
      title: titleM ? htmlToText(titleM[1]) : '',
      description: descM ? htmlToText(descM[1]) : htmlToText(html)
    };
  } else {
    const html = await fetchTextOrJson(parsed.href, 'text/html,application/xhtml+xml');
    const ld = extractJsonLdJob(html);
    if (ld) {
      posting = {
        ...posting,
        source: 'json_ld',
        company: typeof ld.hiringOrganization === 'object' ? ld.hiringOrganization?.name || '' : String(ld.hiringOrganization || ''),
        title: String(ld.title || ''),
        workplace: String(ld.jobLocationType || ''),
        description: htmlToText(String(ld.description || ''))
      };
    } else {
      posting.description = htmlToText(html).slice(0, 12000);
    }
  }

  const { sanitizedText, warnings } = sanitizeJobDescription(posting.description);
  posting.description = sanitizedText;

  return { posting, prompt_injection_warnings: warnings };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido. Use POST.' });

  const url = (req.body && req.body.url) || '';
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Informe o campo "url" da vaga.' });
  }

  try {
    const result = await fetchJobPosting(url);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return res.status(err.statusCode || 502).json({
      error: err.message || 'Não foi possível extrair a descrição da vaga.'
    });
  }
}

handler.validateExternalUrl = validateExternalUrl;
handler.identifySource = identifySource;
handler.htmlToText = htmlToText;
handler.fetchJobPosting = fetchJobPosting;

module.exports = handler;
