const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });

const { executarExtratores } = require('./extractors');
const { filtrarETransformar } = require('./transform');
const { salvarNovasVagas, obterPendentes } = require('../gerenciador_vagas');
const { auditarVagasAtivas } = require('../verificar_vagas_encerradas');
const { registrarExecucao } = require('../registrar_log');

const LOCK_PATH = path.join(ROOT_DIR, '.pipeline.lock');
const LOCK_MAX_AGE_MS = 45 * 60 * 1000; // 45 minutos
const CONFIG_PATH = path.join(ROOT_DIR, 'config_busca.json');
const NOVAS_VAGAS_PATH = path.join(ROOT_DIR, 'novas_vagas.json');
const LOG_PATH = path.join(ROOT_DIR, 'log_execucoes.txt');

function carregarConfigBusca() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.warn('[Pipeline] Aviso: falha ao ler config_busca.json:', e.message);
    return {};
  }
}

function adquirirLock(lockPath = LOCK_PATH) {
  if (fs.existsSync(lockPath)) {
    try {
      const stat = fs.statSync(lockPath);
      const idadeMs = Date.now() - stat.mtimeMs;
      if (idadeMs < LOCK_MAX_AGE_MS) {
        return { adquirido: false, motivo: `Lock ativo há ${Math.round(idadeMs / 1000)}s` };
      }
      console.warn(`[Pipeline] Lock órfão detectado (${Math.round(idadeMs / 60000)} min). Sobrescrevendo...`);
    } catch (e) {}
  }

  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
  return { adquirido: true };
}

function liberarLock(lockPath = LOCK_PATH) {
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch (e) {}
}

function carregarNovasVagasStaged(filePath = NOVAS_VAGAS_PATH) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(v => ({ ...v, fonte: v.fonte || 'agy' }));
  } catch (e) {
    console.warn('[Pipeline] Aviso: novas_vagas.json inválido:', e.message);
    return [];
  }
}

function sincronizarDashboardIndex() {
  const src = path.join(ROOT_DIR, 'dashboard.html');
  const dest = path.join(ROOT_DIR, 'index.html');
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

/**
 * Orquestrador único do pipeline ETL:
 * Extract (determinístico + staging agy) -> Transform -> Load -> Audit -> Notify -> Observability.
 */
async function executarPipeline(options = {}) {
  const skipNetwork = Boolean(options.skipNetwork || process.argv.includes('--skip-network'));
  const dryRun = Boolean(options.dryRun || process.argv.includes('--dry-run'));
  const lockPath = options.lockPath || LOCK_PATH;

  const lock = adquirirLock(lockPath);
  if (!lock.adquirido) {
    console.warn(`[Pipeline] Execução abortada para evitar concorrência (${lock.motivo}).`);
    return { skipped: true, motivo: lock.motivo };
  }

  const t0 = Date.now();
  try {
    console.log(`[Pipeline ETL] Iniciando execução (skipNetwork=${skipNetwork}, dryRun=${dryRun})...`);

    // 1. Carregar parâmetros determinísticos
    const config = carregarConfigBusca();

    // 2. Extract (Conectores determinísticos em paralelo)
    const { jobsBrutas, fontes } = await executarExtratores(config, { skipNetwork });

    // 3. Mesclar eventual saída complementar do agente em novas_vagas.json
    const vagasStaged = carregarNovasVagasStaged();
    if (vagasStaged.length > 0) {
      fontes.agy = {
        status: 'ok',
        brutas: vagasStaged.length,
        latenciaMs: 0,
        erro: null
      };
      jobsBrutas.push(...vagasStaged);
    }

    // 4. Transform & Load
    const { ineditas, funil } = filtrarETransformar(jobsBrutas);
    let vagasSalvas = [];
    if (!dryRun && ineditas.length > 0) {
      vagasSalvas = await salvarNovasVagas(ineditas);
    } else if (dryRun) {
      vagasSalvas = ineditas;
    }

    // Limpar staging após ingestão concluída para garantir idempotência nas próximas rodadas
    if (!dryRun && vagasStaged.length > 0 && fs.existsSync(NOVAS_VAGAS_PATH)) {
      try {
        fs.unlinkSync(NOVAS_VAGAS_PATH);
      } catch (e) {}
    }

    // 5. Auditoria de vagas encerradas
    let auditoria = { verificadas: 0, encerradasCount: 0 };
    if (!skipNetwork && !dryRun) {
      try {
        const resAud = await auditarVagasAtivas({ limite: 60 });
        auditoria = {
          verificadas: resAud.verificadas || 0,
          encerradasCount: resAud.encerradasCount || 0
        };
      } catch (e) {
        console.warn('[Pipeline] Aviso na auditoria de encerramento:', e.message);
      }
    }

    // 6. Notificação de vagas pendentes por e-mail (quando configurado)
    if (!skipNetwork && !dryRun && process.env.EMAIL_ADDRESS && process.env.EMAIL_PASSWORD) {
      try {
        const pendentes = obterPendentes();
        if (pendentes.length > 0) {
          const { verificarEEnviar } = require('../enviar_vagas_pendentes');
          await verificarEEnviar();
        }
      } catch (e) {
        console.warn('[Pipeline] Aviso ao enviar digest de e-mail:', e.message);
      }
    }

    // 7. Telemetria, sincronização local, rotação de logs e alerta de saúde
    const duracaoSegundos = Math.round((Date.now() - t0) / 1000);
    const fontesLista = Object.values(fontes).filter(f => f.status !== 'skipped');
    const todasFontesFalharam = fontesLista.length > 0 && fontesLista.every(f => f.status === 'error');

    let status = 'SEM_VAGAS';
    let mensagem = 'Varredura ETL concluída. Nenhuma vaga nova nesta rodada.';

    if (todasFontesFalharam && vagasSalvas.length === 0) {
      status = 'ERRO_CRAWLER';
      mensagem = 'Todas as fontes determinísticas falharam nesta rodada.';
    } else if (vagasSalvas.length > 0) {
      status = 'VAGAS_SALVAS';
      mensagem = `${vagasSalvas.length} nova(s) oportunidade(s) catalogada(s) via pipeline ETL.`;
    }

    let healthData = null;
    if (!dryRun) {
      const registro = await registrarExecucao({
        status,
        duracaoSegundos,
        mensagem,
        vagas: vagasSalvas,
        fontes,
        funil,
        auditoria,
        persistirSupabase: !skipNetwork
      });
      healthData = registro.healthData;

      sincronizarDashboardIndex();

      // Integração opcional com src/logger.js (Entrega 3)
      try {
        const { rotacionarLogSeNecessario, verificarEDispararAlertaSaude } = require('./logger');
        if (typeof rotacionarLogSeNecessario === 'function') {
          rotacionarLogSeNecessario(LOG_PATH);
        }
        if (typeof verificarEDispararAlertaSaude === 'function' && healthData) {
          await verificarEDispararAlertaSaude(healthData);
        }
      } catch (e) {}
    }

    console.log(`[Pipeline ETL] Concluído em ${duracaoSegundos}s | Status: ${status} | Funil:`, JSON.stringify(funil));
    return {
      skipped: false,
      status,
      duracaoSegundos,
      fontes,
      funil,
      auditoria,
      vagasSalvasCount: vagasSalvas.length,
      healthData
    };
  } finally {
    liberarLock(lockPath);
  }
}

if (require.main === module) {
  executarPipeline()
    .then(res => {
      process.exit(res && res.status === 'ERRO_CRAWLER' ? 1 : 0);
    })
    .catch(err => {
      console.error('[Pipeline ETL] Erro fatal:', err);
      process.exit(1);
    });
}

module.exports = {
  executarPipeline,
  adquirirLock,
  liberarLock
};
