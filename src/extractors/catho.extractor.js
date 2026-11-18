const { fetchWithRetry } = require('./http_client');

function normalizarSlug(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extrairNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return null;
  }
}

/**
 * Extrai vagas de estágio em desenvolvimento da Catho com fallback seguro contra bloqueios.
 */
async function extract(config = {}) {
  const t0 = Date.now();
  const cidadeSlug = normalizarSlug((Array.isArray(config.cidades) && config.cidades[0]) || 'Belo Horizonte');
  const ufSlug = normalizarSlug(config.estado || 'MG');
  const url = `https://www.catho.com.br/vagas/estagio-em-desenvolvimento/${cidadeSlug}-${ufSlug}/`;

  const resp = await fetchWithRetry(url, {}, 1, 10000);
  if (!resp.ok) {
    return {
      source: 'catho',
      ok: false,
      jobs: [],
      durationMs: Date.now() - t0,
      error: resp.error || `HTTP ${resp.statusCode}`
    };
  }

  const nextData = extrairNextData(resp.body);
  if (!nextData) {
    return {
      source: 'catho',
      ok: false,
      jobs: [],
      durationMs: Date.now() - t0,
      error: 'Estrutura __NEXT_DATA__ ausente na Catho (possível bloqueio ou mudança de layout)'
    };
  }

  const rawList =
    nextData.props?.pageProps?.jobList?.data ||
    nextData.props?.pageProps?.jobs ||
    [];

  const jobs = [];
  const seenLinks = new Set();

  for (const j of rawList) {
    const cargo = (j.jobTitle || j.title || '').trim();
    const empresa = (j.companyName || j.company || 'Empresa via Catho').trim();
    let link = (j.url || j.jobUrl || '').trim();
    if (link && link.startsWith('/')) {
      link = `https://www.catho.com.br${link}`;
    }

    if (!cargo || !link || !/^https?:\/\//i.test(link)) continue;
    if (seenLinks.has(link.toLowerCase())) continue;
    seenLinks.add(link.toLowerCase());

    const cidade = j.city || (Array.isArray(config.cidades) && config.cidades[0]) || 'Belo Horizonte';
    const uf = j.state || config.estado || 'MG';
    const modalidade = /remoto|home office/i.test(`${cargo} ${j.workModel || ''}`)
      ? 'Remoto'
      : (/h[íi]brido/i.test(`${cargo} ${j.workModel || ''}`) ? 'Híbrido' : 'Presencial');

    jobs.push({
      empresa,
      cargo,
      modalidade,
      localizacao: `${cidade}/${uf}`,
      turno: 'Tarde / Flexível',
      prazo: 'Inscrições Abertas',
      requisitos: (j.description || 'Estágio em Tecnologia / Desenvolvimento (Catho)').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280),
      link,
      fonte: 'catho'
    });
  }

  return {
    source: 'catho',
    ok: true,
    jobs,
    durationMs: Date.now() - t0,
    error: null
  };
}

module.exports = {
  extract,
  extrairNextData
};
