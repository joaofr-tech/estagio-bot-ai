const linkedinExtractor = require('./linkedin.extractor');
const gupyExtractor = require('./gupy.extractor');
const cathoExtractor = require('./catho.extractor');
const atsExtractor = require('./ats.extractor');

const EXTRATORES = [
  { name: 'linkedin', fn: linkedinExtractor.extract },
  { name: 'gupy', fn: gupyExtractor.extract },
  { name: 'catho', fn: cathoExtractor.extract },
  { name: 'ats_greenhouse_inhire', fn: atsExtractor.extract }
];

/**
 * Executa todos os extratores determinísticos em paralelo (Promise.allSettled)
 * e retorna as vagas brutas consolidadas junto com a telemetria por fonte.
 */
async function executarExtratores(config = {}, options = {}) {
  const { skipNetwork = false } = options;
  const fontes = {};
  const jobsBrutas = [];

  if (skipNetwork) {
    for (const ext of EXTRATORES) {
      fontes[ext.name] = {
        status: 'skipped',
        brutas: 0,
        latenciaMs: 0,
        erro: null
      };
    }
    return { jobsBrutas, fontes };
  }

  const settled = await Promise.allSettled(
    EXTRATORES.map(ext => ext.fn(config))
  );

  for (let i = 0; i < EXTRATORES.length; i++) {
    const ext = EXTRATORES[i];
    const outcome = settled[i];

    if (outcome.status === 'fulfilled' && outcome.value) {
      const res = outcome.value;
      const lista = Array.isArray(res.jobs) ? res.jobs : [];
      fontes[ext.name] = {
        status: res.ok ? 'ok' : 'error',
        brutas: lista.length,
        latenciaMs: res.durationMs || 0,
        erro: res.error || null
      };
      if (lista.length > 0) {
        jobsBrutas.push(...lista);
      }
    } else {
      const msg = outcome.reason ? (outcome.reason.message || String(outcome.reason)) : 'Erro desconhecido';
      fontes[ext.name] = {
        status: 'error',
        brutas: 0,
        latenciaMs: 0,
        erro: msg
      };
    }
  }

  return { jobsBrutas, fontes };
}

module.exports = {
  executarExtratores,
  EXTRATORES
};
