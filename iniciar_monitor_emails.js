/**
 * iniciar_monitor_emails.js
 * Daemon contínuo em segundo plano que executa a cada 60 minutos enquanto o PC estiver ligado.
 */

const { verificarCaixaEntrada } = require('./verificar_emails');

const INTERVALO_PADRAO_MS = 60 * 60 * 1000; // 1 hora

async function loop() {
  console.log('[Monitor Contínuo] Iniciando verificação de e-mails de processos seletivos...');
  try {
    await verificarCaixaEntrada();
  } catch (e) {
    console.error('[Monitor Contínuo] Erro na verificação:', e.message);
  }

  console.log(`[Monitor Contínuo] Próxima verificação agendada para daqui a 60 minutos.`);
  setTimeout(loop, INTERVALO_PADRAO_MS);
}

// Execução imediata da primeira rodada ao iniciar
loop();
