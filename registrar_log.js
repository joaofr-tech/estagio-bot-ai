const fs = require('fs');
const path = require('path');
const { salvarExecucaoSupabase } = require('./supabase_client');
const { writeFileAtomically } = require('./src/repository');

const DEFAULT_HISTORICO_JS_PATH = path.join(__dirname, 'historico_execucoes.js');

/**
 * Lê o array HISTORICO_EXECUCOES a partir de historico_execucoes.js sem colidir com arrays em CRAWLER_HEALTH.
 */
function lerHistoricoExecucoes(jsPath = DEFAULT_HISTORICO_JS_PATH) {
  if (!fs.existsSync(jsPath)) return [];
  try {
    const raw = fs.readFileSync(jsPath, 'utf8');
    const marker = 'window.HISTORICO_EXECUCOES';
    const markerIdx = raw.indexOf(marker);
    const startIdx = markerIdx !== -1 ? raw.indexOf('[', markerIdx) : raw.indexOf('[');
    const endIdx = raw.lastIndexOf(']');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const jsonStr = raw.substring(startIdx, endIdx + 1);
      const parsed = JSON.parse(jsonStr);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.error('Erro ao ler historico:', e);
  }
  return [];
}

/**
 * Detecta fontes que retornaram 0 vagas ou erro por N execuções consecutivas (Zero-Yield).
 */
function detectarZeroYieldFontes(historico, limiteRodadas = 3) {
  if (!Array.isArray(historico)) return [];
  const comFontes = historico.filter(h => h && h.fontes && typeof h.fontes === 'object');
  if (comFontes.length < limiteRodadas) return [];

  const janela = comFontes.slice(0, limiteRodadas);
  const nomesFontes = new Set();
  for (const run of janela) {
    Object.keys(run.fontes).forEach(k => nomesFontes.add(k));
  }

  const avisos = [];
  for (const fonte of nomesFontes) {
    const todasSemRetorno = janela.every(run => {
      const f = run.fontes[fonte];
      if (!f || f.status === 'skipped') return false;
      return f.status === 'error' || (f.brutas || 0) === 0;
    });
    if (todasSemRetorno) {
      avisos.push(`Fonte '${fonte}' sem retorno há ${limiteRodadas} rodadas`);
    }
  }

  return avisos;
}

/**
 * Registra uma execução no historico_execucoes.js e envia telemetria ao Supabase.
 */
async function registrarExecucao(opcoes = {}) {
  const jsPath = opcoes.jsPath || DEFAULT_HISTORICO_JS_PATH;
  const status = opcoes.status || 'SEM_VAGAS';
  const duracaoRaw = opcoes.duracaoSegundos !== undefined ? opcoes.duracaoSegundos : 30;
  const duracao = !isNaN(parseInt(duracaoRaw, 10)) ? parseInt(duracaoRaw, 10) : 30;
  const mensagem = opcoes.mensagem || 'Varredura finalizada com sucesso.';

  let novasVagas = Array.isArray(opcoes.vagas) ? opcoes.vagas : [];
  if (novasVagas.length === 0 && opcoes.jsonVagasPath && fs.existsSync(opcoes.jsonVagasPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(opcoes.jsonVagasPath, 'utf8'));
      if (Array.isArray(parsed)) novasVagas = parsed;
    } catch (e) {}
  }

  let historico = lerHistoricoExecucoes(jsPath);

  const agora = new Date();
  const dataFormatada = agora.toLocaleString('pt-BR');

  const isErro = status.includes('ERRO') || status.includes('FALHA') || (duracao < 15 && novasVagas.length === 0 && status !== 'SEM_VAGAS');

  const novaExecucao = {
    timestamp: dataFormatada,
    status,
    isErro,
    duracaoSegundos: duracao,
    mensagem,
    vagas: novasVagas
  };

  if (opcoes.fontes && typeof opcoes.fontes === 'object') {
    novaExecucao.fontes = opcoes.fontes;
  }
  if (opcoes.funil && typeof opcoes.funil === 'object') {
    novaExecucao.funil = opcoes.funil;
  }
  if (opcoes.auditoria && typeof opcoes.auditoria === 'object') {
    novaExecucao.auditoria = opcoes.auditoria;
  }

  historico.unshift(novaExecucao);
  if (historico.length > 50) {
    historico = historico.slice(0, 50);
  }

  const falhasConsecutivas = historico.findIndex(h => !h.isErro && h.status !== 'ERRO_CRAWLER');
  const totalFalhas = falhasConsecutivas === -1 ? historico.length : falhasConsecutivas;
  const avisosFontes = detectarZeroYieldFontes(historico, 3);

  let healthStatus = 'healthy';
  let healthMsg = 'Crawler operando normalmente.';
  if (isErro || totalFalhas > 0) {
    healthStatus = totalFalhas >= 3 ? 'critical' : 'warning';
    healthMsg = `Falha detectada na varredura (${mensagem}).`;
  } else if (avisosFontes.length > 0) {
    healthStatus = 'warning';
    healthMsg = avisosFontes.join(' | ');
  }

  const healthData = {
    status: healthStatus,
    ultimaExecucao: dataFormatada,
    ultimoStatus: status,
    duracaoSegundos: duracao,
    falhasConsecutivas: totalFalhas,
    avisosFontes,
    mensagem: healthMsg
  };

  const outputContent = `window.CRAWLER_HEALTH = ${JSON.stringify(healthData, null, 2)};\nwindow.HISTORICO_EXECUCOES = ${JSON.stringify(historico, null, 2)};\n`;

  writeFileAtomically(jsPath, outputContent);
  console.log(`Observabilidade local atualizada com sucesso. Status = ${healthStatus} (Duração: ${duracao}s)`);

  if (opcoes.persistirSupabase !== false) {
    try {
      await salvarExecucaoSupabase({
        timestamp: dataFormatada,
        status,
        isErro,
        duracaoSegundos: duracao,
        mensagem,
        totalVagas: novasVagas.length
      });
    } catch (err) {
      console.warn('[Supabase] Telemetria em nuvem não registrada:', err.message);
    }
  }

  return { healthData, novaExecucao };
}

if (require.main === module) {
  const status = process.argv[2] || 'SEM_VAGAS';
  const duracaoArg = process.argv[3];
  const duracaoSegundos = (duracaoArg !== undefined && !isNaN(parseInt(duracaoArg, 10))) ? parseInt(duracaoArg, 10) : 30;
  const mensagem = process.argv[4] || 'Varredura finalizada com sucesso.';
  const jsonVagasPath = process.argv[5];

  registrarExecucao({
    status,
    duracaoSegundos,
    mensagem,
    jsonVagasPath
  }).then(() => process.exit(0)).catch(err => {
    console.error('[Observabilidade] Erro ao registrar execução:', err);
    process.exit(1);
  });
}

module.exports = {
  registrarExecucao,
  lerHistoricoExecucoes,
  detectarZeroYieldFontes
};
