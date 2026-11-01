const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const BANCO_PATH = path.join(__dirname, 'banco_vagas.json');
const BANCO_JS_PATH = path.join(__dirname, 'banco_vagas.js');

function carregarBanco() {
  if (!fs.existsSync(BANCO_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(BANCO_PATH, 'utf8'));
  } catch (e) {
    return [];
  }
}

function salvarBanco(banco) {
  fs.writeFileSync(BANCO_PATH, JSON.stringify(banco, null, 2), 'utf8');
  fs.writeFileSync(BANCO_JS_PATH, `window.BANCO_VAGAS = ${JSON.stringify(banco, null, 2)};\n`, 'utf8');
}

/**
 * Remove permanentemente vagas marcadas como encerradas ou links quebrados/finalizados.
 */
function expurgarVagasEncerradas() {
  const banco = carregarBanco();
  const ativas = banco.filter(v => v.status !== 'encerrada');
  const removidas = banco.length - ativas.length;

  salvarBanco(ativas);
  console.log(`[Varredura de Encerramento] ${removidas} vaga(s) encerrada(s) expurgada(s) da base.`);
  return ativas;
}

if (require.main === module) {
  expurgarVagasEncerradas();
}

module.exports = { expurgarVagasEncerradas };
