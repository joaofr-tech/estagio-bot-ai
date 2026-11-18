const { fetchWithRetry } = require('./http_client');

function normalizarSemAcento(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function extrairNextData(html) {
  const idx = html.indexOf('id="__NEXT_DATA__"');
  if (idx === -1) return null;
  const start = html.indexOf('>', idx);
  if (start === -1) return null;
  const end = html.indexOf('</script>', start + 1);
  if (end === -1) return null;
  try {
    return JSON.parse(html.substring(start + 1, end));
  } catch (e) {
    return null;
  }
}

function mapearModalidadeGupy(workplaceType, isRemoteWork) {
  const wt = normalizarSemAcento(workplaceType);
  if (isRemoteWork || wt === 'remote') return 'Remoto';
  if (wt === 'hybrid') return 'Híbrido';
  return 'Presencial';
}

function vagaCompativelComLocal(job, config) {
  const isRemoto = job.isRemoteWork || normalizarSemAcento(job.workplaceType) === 'remote';
  if (isRemoto) {
    return config.aceitaRemoto !== false;
  }

  const cidadesAlvo = Array.isArray(config.cidades) && config.cidades.length > 0
    ? config.cidades.map(normalizarSemAcento)
    : ['belo horizonte', 'contagem', 'betim', 'nova lima', 'ibirite'];
  const estadoAlvo = normalizarSemAcento(config.estado || 'MG');

  const cityNorm = normalizarSemAcento(job.city);
  const stateNorm = normalizarSemAcento(job.state);

  if (cidadesAlvo.some(c => cityNorm.includes(c))) return true;
  if (estadoAlvo && (stateNorm === estadoAlvo || stateNorm === 'minas gerais')) {
    return cidadesAlvo.some(c => cityNorm.includes(c));
  }
  return false;
}

function buildGupyLink(job) {
  if (job.jobUrl && /^https?:\/\//i.test(job.jobUrl)) return job.jobUrl.trim();
  if (job.careerPageUrl && job.id) {
    return `${job.careerPageUrl.replace(/\/$/, '')}/jobs/${job.id}`;
  }
  if (job.careerPageName && job.id) {
    const slug = normalizarSemAcento(job.careerPageName).replace(/[^a-z0-9]/g, '');
    if (slug) return `https://${slug}.gupy.io/jobs/${job.id}`;
  }
  return `https://portal.gupy.io/job-search/term=${encodeURIComponent(job.name || 'estagio')}`;
}

/**
 * Extrai vagas de estágio em tecnologia diretamente do portal Gupy via __NEXT_DATA__.
 */
async function extract(config = {}) {
  const t0 = Date.now();
  const termos = ['estagio desenvolvimento', 'estagio dados'];
  const urls = termos.map(t => `https://portal.gupy.io/job-search/term=${encodeURIComponent(t)}`);

  const porId = new Map();
  let requisicoesOk = 0;
  let ultimoErro = null;

  for (const url of urls) {
    const resp = await fetchWithRetry(url, {}, 2, 10000);
    if (!resp.ok) {
      ultimoErro = resp.error || `HTTP ${resp.statusCode}`;
      continue;
    }

    const nextData = extrairNextData(resp.body);
    if (!nextData) {
      ultimoErro = 'Estrutura __NEXT_DATA__ não encontrada no portal Gupy';
      continue;
    }

    requisicoesOk++;
    const list = nextData.props?.pageProps?.data || [];
    for (const j of list) {
      const cargo = (j.name || '').trim();
      const normCargo = normalizarSemAcento(cargo);
      const isEstagio = normCargo.includes('estag') || normCargo.includes('intern') || normalizarSemAcento(j.type).includes('internship');
      if (!isEstagio) continue;
      if (!vagaCompativelComLocal(j, config)) continue;

      const key = String(j.id || `${j.careerPageName}::${cargo}`);
      if (porId.has(key)) continue;

      const modalidade = mapearModalidadeGupy(j.workplaceType, j.isRemoteWork);
      const locPartes = [j.city, j.state].filter(Boolean);
      const localizacao = modalidade === 'Remoto'
        ? 'Remoto - Brasil'
        : (locPartes.length > 0 ? locPartes.join('/') : 'Minas Gerais');

      porId.set(key, {
        empresa: (j.careerPageName || j.companyName || 'Empresa via Gupy').trim(),
        cargo,
        modalidade,
        localizacao,
        turno: 'Tarde / Flexível',
        prazo: j.applicationDeadline ? `Prazo: ${j.applicationDeadline}` : 'Inscrições Abertas',
        requisitos: (j.description || 'Estágio em Tecnologia / Desenvolvimento (Gupy)').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280),
        link: buildGupyLink(j),
        fonte: 'gupy'
      });
    }
  }

  const ok = requisicoesOk > 0;
  return {
    source: 'gupy',
    ok,
    jobs: Array.from(porId.values()),
    durationMs: Date.now() - t0,
    error: ok ? null : ultimoErro || 'Falha ao consultar portal Gupy'
  };
}

module.exports = {
  extract,
  extrairNextData
};
