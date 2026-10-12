const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, 'historico_execucoes.js');
const status = process.argv[2] || 'SEM_VAGAS';
const duracao = parseInt(process.argv[3], 10) || 30;
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

historico.unshift({
  timestamp: dataFormatada,
  status: status,
  duracaoSegundos: duracao,
  mensagem: mensagem,
  vagas: novasVagas
});

if (historico.length > 50) {
  historico = historico.slice(0, 50);
}

fs.writeFileSync(jsPath, `window.HISTORICO_EXECUCOES = ${JSON.stringify(historico, null, 2)};\n`, 'utf8');
console.log("Observabilidade atualizada com sucesso.");
