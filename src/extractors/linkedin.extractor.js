const { fetchWithRetry } = require('./http_client');

function decodeHtmlEntities(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarSemAcento(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function parseLinkedInCards(html) {
  const jobs = [];
  const cards = html.split(/<li>\s*<div[^>]*class="[^"]*base-card/i).slice(1);

  for (const card of cards) {
    const idMatch = card.match(/jobPosting:(\d+)/);
    if (!idMatch) continue;
    const id = idMatch[1];

    const titleMatch = card.match(/<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i);
    const companyMatch = card.match(/<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
      || card.match(/<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i);
    const locationMatch = card.match(/<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i);

    const cargo = decodeHtmlEntities(titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '') : '');
    const empresa = decodeHtmlEntities(companyMatch ? companyMatch[1].replace(/<[^>]+>/g, '') : '');
    const localizacao = decodeHtmlEntities(locationMatch ? locationMatch[1].replace(/<[^>]+>/g, '') : '');

    if (!cargo && !empresa) continue;

    jobs.push({
      id,
      empresa: empresa || 'Empresa Confidencial',
      cargo: cargo || 'Estágio TI',
      localizacao: localizacao || 'Belo Horizonte / MG',
      link: `https://www.linkedin.com/jobs/view/${id}/`
    });
  }

  return jobs;
}

function inferirModalidade(cargo, localizacao) {
  const texto = normalizarSemAcento(`${cargo} ${localizacao}`);
  if (texto.includes('remoto') || texto.includes('remote') || texto.includes('home office')) {
    return 'Remoto';
  }
  if (texto.includes('hibrido') || texto.includes('hybrid')) {
    return 'Híbrido';
  }
  return 'Presencial';
}

function isLocalizacaoValida(localizacao, config = {}) {
  const norm = normalizarSemAcento(localizacao);
  if (!norm) return false;

  const termosEstrangeiros = [
    'estados unidos',
    'united states',
    'california',
    'texas',
    'washington',
    'seattle',
    'austin',
    'long beach',
    'new york',
    'florida',
    'canada',
    'united kingdom',
    'alemanha',
    'germany',
    'portugal',
    'espanha',
    'franca',
    'india'
  ];
  if (termosEstrangeiros.some(t => norm.includes(t))) {
    return false;
  }

  const cidadesAlvo = Array.isArray(config.cidades) && config.cidades.length > 0
    ? config.cidades.map(normalizarSemAcento)
    : ['belo horizonte', 'contagem', 'betim', 'nova lima', 'ibirite'];
  const estadoAlvo = normalizarSemAcento(config.estado || 'MG');

  if (cidadesAlvo.some(c => norm.includes(c))) return true;
  if (norm.includes('minas gerais') || new RegExp(`\\b${estadoAlvo}\\b`).test(norm)) return true;

  if (config.aceitaRemoto !== false) {
    const ufsBrasil = /\b(brasil|brazil|sp|rj|pr|sc|rs|df|go|ba|pe|ce|es)\b/;
    if (ufsBrasil.test(norm)) return true;
  }

  return false;
}

function isVagaTechEstagio(cargo) {
  const norm = normalizarSemAcento(cargo);
  const termosBloqueados = [
    'suporte',
    'helpdesk',
    'help desk',
    'infraestrutura',
    'nivel medio',
    'comercial',
    'producao',
    'consultoria e gestao'
  ];
  if (termosBloqueados.some(t => norm.includes(t))) {
    return false;
  }

  const temEstagio = /\b(estag|intern|trainee)\b/i.test(norm) || norm.includes('estagi');
  const temTech = /(\b(dev|ia|ti|qa)\b|software|desenvolv|dados|data|analytics|inteligencia artificial|sistemas|programacao|computacao|tecnologia|backend|frontend|full ?stack|mobile|cloud|engenharia)/i.test(norm);
  return temEstagio && temTech;
}

/**
 * Extrai vagas de estágio em TI da Guest API pública do LinkedIn.
 */
async function extract(config = {}) {
  const t0 = Date.now();
  const cidadeBase = (Array.isArray(config.cidades) && config.cidades[0]) || 'Belo Horizonte';
  const termos = ['estagio ti', 'estagio engenharia software', 'estagio dados'];

  const urls = termos.map(
    termo =>
      `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(termo)}&location=${encodeURIComponent(cidadeBase)}&f_TPR=r604800&start=0`
  );

  if (config.aceitaRemoto !== false) {
    urls.push(
      `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent('estagio desenvolvimento software')}&geoId=106057199&f_WT=2&f_TPR=r604800&start=0`
    );
  }

  const porId = new Map();
  let requisicoesOk = 0;
  let ultimoErro = null;

  for (const url of urls) {
    const resp = await fetchWithRetry(url, {}, 2, 10000);
    if (resp.ok) {
      requisicoesOk++;
      const cards = parseLinkedInCards(resp.body);
      for (const item of cards) {
        if (!isVagaTechEstagio(item.cargo)) continue;
        if (!isLocalizacaoValida(item.localizacao, config)) continue;
        if (!porId.has(item.id)) {
          porId.set(item.id, {
            empresa: item.empresa,
            cargo: item.cargo,
            modalidade: inferirModalidade(item.cargo, item.localizacao),
            localizacao: item.localizacao,
            turno: 'Tarde / Flexível',
            prazo: 'Inscrições Abertas',
            requisitos: 'Estágio em Tecnologia / Desenvolvimento',
            link: item.link,
            fonte: 'linkedin'
          });
        }
      }
    } else {
      ultimoErro = resp.error || `HTTP ${resp.statusCode}`;
    }
  }

  const ok = requisicoesOk > 0;
  return {
    source: 'linkedin',
    ok,
    jobs: Array.from(porId.values()),
    durationMs: Date.now() - t0,
    error: ok ? null : ultimoErro || 'Falha em todas as consultas LinkedIn'
  };
}

module.exports = {
  extract,
  parseLinkedInCards,
  isLocalizacaoValida,
  isVagaTechEstagio
};
