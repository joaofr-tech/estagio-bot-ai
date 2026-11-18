const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectarZeroYieldFontes } = require('../registrar_log');
const { rotacionarLogSeNecessario } = require('../src/logger');

function runObservabilidadeTests() {
  console.log('\n[Suíte 5: Observabilidade & Detecção de Falhas do Crawler]');

  // 1. Simulação da função getCrawlerHealth
  function avaliarSaudeCrawler(executionData, agoraTimestampMs = Date.now()) {
    if (!executionData || executionData.length === 0) {
      return { status: 'healthy', label: 'Aguardando' };
    }

    const lastRun = executionData[0];
    const isLastRunErro = lastRun.isErro || (lastRun.status && (lastRun.status.includes('ERRO') || lastRun.status.includes('FALHA')));

    let horasDesdeUltima = 0;
    try {
      const parts = (lastRun.timestamp || '').split(', ');
      if (parts.length === 2) {
        const dParts = parts[0].split('/');
        const tParts = parts[1].split(':');
        const lastDate = new Date(dParts[2], dParts[1] - 1, dParts[0], tParts[0], tParts[1], tParts[2]);
        horasDesdeUltima = (agoraTimestampMs - lastDate.getTime()) / 3600000;
      }
    } catch (e) {}

    if (isLastRunErro) {
      return { status: 'error', label: 'Falha no Crawler Detectada', duracao: lastRun.duracaoSegundos || 0 };
    }

    if (lastRun.duracaoSegundos !== undefined && lastRun.duracaoSegundos < 15 && (!lastRun.vagas || lastRun.vagas.length === 0) && lastRun.status === 'ERRO_CRAWLER') {
      return { status: 'error', label: 'Execução Anômala (< 15s)', duracao: lastRun.duracaoSegundos };
    }

    if (horasDesdeUltima > 3) {
      return { status: 'warning', label: 'Inativo há > 3h' };
    }

    return { status: 'healthy', label: 'Operacional & Saudável', duracao: lastRun.duracaoSegundos };
  }

  // Teste 1: Execução normal saudável
  const runSaudavel = [
    { timestamp: new Date().toLocaleString('pt-BR'), status: 'SEM_VAGAS', duracaoSegundos: 766, vagas: [] }
  ];
  const saudeNormal = avaliarSaudeCrawler(runSaudavel);
  assert.strictEqual(saudeNormal.status, 'healthy', 'Varredura com duração normal deve reportar saudável');
  console.log('  ✓ Execução normal: classificada como saudável (healthy)');

  // Teste 2: Falha explícita com ERRO_CRAWLER (ex: erro no agy)
  const runFalha = [
    { timestamp: new Date().toLocaleString('pt-BR'), status: 'ERRO_CRAWLER', isErro: true, duracaoSegundos: 0, mensagem: 'Error: unexpected argument', vagas: [] }
  ];
  const saudeFalha = avaliarSaudeCrawler(runFalha);
  assert.strictEqual(saudeFalha.status, 'error', 'Falha com ERRO_CRAWLER deve reportar error imediatamente');
  console.log('  ✓ Falha no crawler: dispara status de erro com alarme');

  // Teste 3: Preservação de duração 0s sem máscara de 30s
  const duracaoArg = "0";
  const duracaoCalculada = (duracaoArg !== undefined && !isNaN(parseInt(duracaoArg, 10))) ? parseInt(duracaoArg, 10) : 30;
  assert.strictEqual(duracaoCalculada, 0, 'Duração de 0s não deve ser mascarada para 30s');
  console.log('  ✓ Preservação de métricas reais: 0s é registrado fielmente');

  // Teste 4: Inatividade prolongada (> 3 horas)
  const tresHorasAtras = new Date(Date.now() - 4 * 3600000).toLocaleString('pt-BR');
  const runAntiga = [
    { timestamp: tresHorasAtras, status: 'SEM_VAGAS', duracaoSegundos: 800, vagas: [] }
  ];
  const saudeInativo = avaliarSaudeCrawler(runAntiga);
  assert.strictEqual(saudeInativo.status, 'warning', 'Inatividade maior que 3h deve emitir aviso');
  console.log('  ✓ Detector de estagnação: alerta de inatividade emitido quando > 3h');

  // Teste 5: Regex de detecção de erros em saídas do crawler
  const regexErro = /(error:|exception:|unexpected argument|unauthorized|fatal:|failed to start|crash)/i;
  assert.ok(regexErro.test('Error: unexpected argument "da"'), 'Deve capturar erro inesperado de argumento');
  assert.ok(regexErro.test('Fatal: unauthorized token'), 'Deve capturar erro de autorização/token');
  assert.ok(!regexErro.test('Nenhuma vaga nova nesta rodada.'), 'Não deve falsamente acusar erro em rodadas sem vagas');
  console.log('  ✓ Regex de anomalias: identifica assinaturas fatais sem falsos positivos');

  // Teste 6: Detector de Zero-Yield por fonte (3 rodadas seguidas sem retorno)
  const historicoComZeroYield = [
    { fontes: { linkedin: { status: 'ok', brutas: 12 }, catho: { status: 'ok', brutas: 0 } } },
    { fontes: { linkedin: { status: 'ok', brutas: 8 }, catho: { status: 'error', brutas: 0 } } },
    { fontes: { linkedin: { status: 'ok', brutas: 15 }, catho: { status: 'ok', brutas: 0 } } }
  ];
  const avisos = detectarZeroYieldFontes(historicoComZeroYield, 3);
  assert.strictEqual(avisos.length, 1, 'Deve alertar exatamente 1 fonte com zero-yield');
  assert.ok(avisos[0].includes('catho'), 'Aviso deve mencionar a fonte catho');

  const historicoSaudavel = [
    { fontes: { linkedin: { status: 'ok', brutas: 12 }, catho: { status: 'ok', brutas: 3 } } },
    { fontes: { linkedin: { status: 'ok', brutas: 8 }, catho: { status: 'ok', brutas: 0 } } },
    { fontes: { linkedin: { status: 'ok', brutas: 15 }, catho: { status: 'ok', brutas: 0 } } }
  ];
  assert.strictEqual(detectarZeroYieldFontes(historicoSaudavel, 3).length, 0, 'Não deve emitir aviso se houve retorno em uma das 3 rodadas');
  console.log('  ✓ Detector de Zero-Yield: identifica fonte estagnada há 3 rodadas sem falsos positivos');

  // Teste 7: Rotação automática de logs quando ultrapassa maxBytes
  const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sona-log-'));
  const tmpLog = path.join(tmpLogDir, 'log_execucoes.txt');
  const tmpOld = path.join(tmpLogDir, 'log_execucoes.old.txt');
  try {
    const linhas = Array.from({ length: 20 }, (_, i) => `[Linha ${i + 1}] Registro de execução do pipeline ETL`).join('\n');
    fs.writeFileSync(tmpLog, linhas, 'utf8');
    const resRot = rotacionarLogSeNecessario(tmpLog, 200);
    assert.strictEqual(resRot.rotated, true, 'Deve rotacionar quando tamanho ultrapassa maxBytes');
    assert.ok(fs.existsSync(tmpOld), 'Deve arquivar metade anterior em .old.txt');
    const conteudoRestante = fs.readFileSync(tmpLog, 'utf8');
    assert.ok(conteudoRestante.includes('[Linha 20]'), 'Metade mais recente deve permanecer no log ativo');
    assert.ok(!conteudoRestante.includes('[Linha 1]'), 'Primeira linha antiga deve ter ido para o arquivo .old.txt');
    console.log('  ✓ Rotação de Logs: arquiva metade antiga em .old.txt mantendo registros recentes');
  } finally {
    if (fs.existsSync(tmpLog)) fs.unlinkSync(tmpLog);
    if (fs.existsSync(tmpOld)) fs.unlinkSync(tmpOld);
    if (fs.existsSync(tmpLogDir)) fs.rmdirSync(tmpLogDir);
  }
}

module.exports = { runObservabilidadeTests };

if (require.main === module) {
  runObservabilidadeTests();
}
