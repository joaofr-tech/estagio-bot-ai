const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, 'historico_execucoes.js');
const status = process.argv[2] || 'SEM_VAGAS';
const duracaoArg = process.argv[3];
const duracao = (duracaoArg !== undefined && !isNaN(parseInt(duracaoArg, 10))) ? parseInt(duracaoArg, 10) : 30;
const mensagem = process.argv[4] || 'Varredura finalizada com sucesso.';
const jsonVagasPath = process.argv[5];

let novasVagas = [];
if (jsonVagasPath && fs.existsSync(jsonVagasPath)) {
  try {
    novasVagas = JSON.parse(fs.readFileSync(jsonVagasPath, 'utf8'));
  } catch (e) {}
}

let historico = [];
if (fs.existsSync(jsPath)) {
  try {
    const raw = fs.readFileSync(jsPath, 'utf8');
    const startIdx = raw.indexOf('[');
    const endIdx = raw.lastIndexOf(']');
    if (startIdx !== -1 && endIdx !== -1) {
      const jsonStr = raw.substring(startIdx, endIdx + 1);
      historico = JSON.parse(jsonStr);
    }
  } catch (e) {
    console.error("Erro ao ler historico:", e);
  }
}

const agora = new Date();
const dataFormatada = agora.toLocaleString('pt-BR');

const isErro = status.includes('ERRO') || status.includes('FALHA') || (duracao < 15 && novasVagas.length === 0 && status !== 'SEM_VAGAS');

historico.unshift({
  timestamp: dataFormatada,
  status: status,
  isErro: isErro,
  duracaoSegundos: duracao,
  mensagem: mensagem,
  vagas: novasVagas
});

if (historico.length > 50) {
  historico = historico.slice(0, 50);
}

// Calcular indicador de saúde do crawler (Observabilidade)
const falhasConsecutivas = historico.findIndex(h => !h.isErro && h.status !== 'ERRO_CRAWLER');
const totalFalhas = falhasConsecutivas === -1 ? historico.length : falhasConsecutivas;

let healthStatus = 'healthy';
let healthMsg = 'Crawler operando normalmente.';
if (isErro || totalFalhas > 0) {
  healthStatus = totalFalhas >= 3 ? 'critical' : 'warning';
  healthMsg = `Falha detectada na varredura (${mensagem}).`;
}

const healthData = {
  status: healthStatus,
  ultimaExecucao: dataFormatada,
  ultimoStatus: status,
  duracaoSegundos: duracao,
  falhasConsecutivas: totalFalhas,
  mensagem: healthMsg
};

const outputContent = `window.CRAWLER_HEALTH = ${JSON.stringify(healthData, null, 2)};\nwindow.HISTORICO_EXECUCOES = ${JSON.stringify(historico, null, 2)};\n`;

fs.writeFileSync(jsPath, outputContent, 'utf8');
console.log(`Observabilidade atualizada com sucesso. Status = ${healthStatus} (Duração: ${duracao}s)`);
