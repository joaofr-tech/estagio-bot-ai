const { fetchWithRetry } = require('./http_client');

const GREENHOUSE_BOARDS = [
  { slug: 'ifoodcarreiras', empresa: 'iFood' },
  { slug: 'vtex', empresa: 'VTEX' },
  { slug: 'incognia-conf', empresa: 'Incognia' },
  { slug: 'artefactjobs', empresa: 'Artefact' }
];

const INHIRE_TENANTS = [
  { slug: 'radix', empresa: 'Radix' },
  { slug: 'elogroup', empresa: 'EloGroup' },
  { slug: 'atlantico', empresa: 'Instituto Atlântico' },
  { slug: 'nuvidio', empresa: 'Nuvidio' }
];

function normalizarSemAcento(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function slugify(texto) {
  return normalizarSemAcento(texto)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isEstagioTech(cargo) {
  const norm = normalizarSemAcento(cargo);
  const bloqueados = ['suporte', 'helpdesk', 'comercial', 'vendas', 'sdr', 'juridico', 'direito', 'rh', 'recursos humanos', 'financeiro', 'contabil', 'marketing'];
  if (bloqueados.some(t => norm.includes(t))) return false;

  const temEstagio = /\b(estag|intern|estagiario|estagiaria)\b/i.test(norm) || norm.includes('estagi');
  if (!temEstagio) return false;

  // Se menciona intern/estágio em empresa de tech, aceita quando não é área não-técnica ou quando menciona termos tech/dados/produto/engenharia
  return /(\b(dev|ai|ia|ti|qa)\b|software|desenvolv|dados|data|analytics|inteligencia artificial|engenharia|engineering|tecnologia|sistemas|backend|frontend|full ?stack|mobile|qualidade|cloud|produto|product|computacao)/i.test(norm);
}

function inferirModalidade(workplaceType, locationStr, cargo) {
  const texto = normalizarSemAcento(`${workplaceType || ''} ${locationStr || ''} ${cargo || ''}`);
  if (texto.includes('remote') || texto.includes('remoto') || texto.includes('home office')) {
    return 'Remoto';
  }
  if (texto.includes('hybrid') || texto.includes('hibrido')) {
    return 'Híbrido';
  }
  return 'Presencial';
}

function isLocalCompativel(modalidade, locationStr, config = {}) {
  const normLoc = normalizarSemAcento(locationStr);
  const estrangeiros = ['united states', 'estados unidos', 'usa', 'mexico', 'colombia', 'argentina', 'chile', 'peru', 'europe', 'portugal', 'spain', 'uk', 'singapore'];
  if (estrangeiros.some(t => normLoc.includes(t))) {
    // Só aceita se também mencionar explicitamente Brasil/Remote Brazil
    if (!normLoc.includes('brasil') && !normLoc.includes('brazil') && !normLoc.includes('belo horizonte')) {
      return false;
    }
  }

  if (modalidade === 'Remoto') {
    return config.aceitaRemoto !== false;
  }

  const cidades = Array.isArray(config.cidades) && config.cidades.length > 0
    ? config.cidades.map(normalizarSemAcento)
    : ['belo horizonte', 'contagem', 'betim', 'nova lima', 'ibirite'];

  if (cidades.some(c => normLoc.includes(c))) return true;
  if (normLoc.includes('minas gerais') || /\bmg\b/.test(normLoc)) return true;

  // Quando o ATS só informa "BR" ou "Brasil" sem cidade, aceita apenas se remoto ou flexível aceito
  if ((normLoc === 'br' || normLoc === 'brasil' || normLoc === 'brazil') && config.aceitaRemoto !== false) {
    return true;
  }

  return false;
}

async function fetchGreenhouseBoard(board, config) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}/jobs`;
  const resp = await fetchWithRetry(url, { headers: { Accept: 'application/json' } }, 1, 8000);
  if (!resp.ok) {
    return { ok: false, jobs: [], error: resp.error || `HTTP ${resp.statusCode}` };
  }

  let data;
  try {
    data = JSON.parse(resp.body);
  } catch (e) {
    return { ok: false, jobs: [], error: 'JSON inválido Greenhouse' };
  }

  const jobs = [];
  for (const j of (data.jobs || [])) {
    const cargo = (j.title || '').trim();
    if (!isEstagioTech(cargo)) continue;

    const locationStr = (j.location && j.location.name) ? j.location.name.trim() : 'Brasil';
    const modalidade = inferirModalidade('', locationStr, cargo);
    if (!isLocalCompativel(modalidade, locationStr, config)) continue;

    if (!j.absolute_url) continue;

    jobs.push({
      empresa: board.empresa,
      cargo,
      modalidade,
      localizacao: locationStr,
      turno: 'Tarde / Flexível',
      prazo: 'Inscrições Abertas',
      requisitos: `Estágio via Greenhouse (${board.empresa})`,
      link: j.absolute_url.trim(),
      fonte: 'greenhouse'
    });
  }

  return { ok: true, jobs, error: null };
}

async function fetchInHireTenant(tenant, config) {
  const url = 'https://api.inhire.app/job-posts/public/pages';
  const resp = await fetchWithRetry(
    url,
    {
      headers: {
        Accept: 'application/json',
        'X-Tenant': tenant.slug,
        Origin: `https://${tenant.slug}.inhire.app`
      }
    },
    1,
    8000
  );

  if (!resp.ok) {
    return { ok: false, jobs: [], error: resp.error || `HTTP ${resp.statusCode}` };
  }

  let data;
  try {
    data = JSON.parse(resp.body);
  } catch (e) {
    return { ok: false, jobs: [], error: 'JSON inválido InHire' };
  }

  const jobs = [];
  const empresaNome = (data.tenantName || tenant.empresa || tenant.slug).trim();
  const list = Array.isArray(data.jobsPage) ? data.jobsPage : [];

  for (const j of list) {
    if (j.status && j.status !== 'published') continue;
    const cargo = (j.displayName || '').trim();
    if (!isEstagioTech(cargo)) continue;

    const locationStr = (j.location || 'Brasil').trim();
    const modalidade = inferirModalidade(j.workplaceType, locationStr, cargo);
    if (!isLocalCompativel(modalidade, locationStr, config)) continue;
    if (!j.jobId) continue;

    const slugCargo = slugify(cargo) || 'vaga';
    jobs.push({
      empresa: empresaNome,
      cargo,
      modalidade,
      localizacao: modalidade === 'Remoto' ? 'Remoto - Brasil' : locationStr,
      turno: 'Tarde / Flexível',
      prazo: 'Inscrições Abertas',
      requisitos: `Estágio via InHire (${empresaNome})`,
      link: `https://${tenant.slug}.inhire.app/vagas/${j.jobId}/${slugCargo}`,
      fonte: 'inhire'
    });
  }

  return { ok: true, jobs, error: null };
}

/**
 * Extrai vagas diretamente das APIs públicas do Greenhouse e InHire.
 */
async function extract(config = {}) {
  const t0 = Date.now();
  const tasks = [
    ...GREENHOUSE_BOARDS.map(b => fetchGreenhouseBoard(b, config)),
    ...INHIRE_TENANTS.map(t => fetchInHireTenant(t, config))
  ];

  const settled = await Promise.allSettled(tasks);
  const jobs = [];
  const seenLinks = new Set();
  let okCount = 0;
  let lastErr = null;

  for (const item of settled) {
    if (item.status === 'fulfilled' && item.value) {
      if (item.value.ok) {
        okCount++;
        for (const j of item.value.jobs) {
          const k = j.link.toLowerCase();
          if (!seenLinks.has(k)) {
            seenLinks.add(k);
            jobs.push(j);
          }
        }
      } else if (item.value.error) {
        lastErr = item.value.error;
      }
    } else if (item.reason) {
      lastErr = item.reason.message || String(item.reason);
    }
  }

  const ok = okCount > 0;
  return {
    source: 'ats_greenhouse_inhire',
    ok,
    jobs,
    durationMs: Date.now() - t0,
    error: ok ? null : lastErr || 'Falha ao consultar boards Greenhouse/InHire'
  };
}

module.exports = {
  extract,
  GREENHOUSE_BOARDS,
  INHIRE_TENANTS
};
