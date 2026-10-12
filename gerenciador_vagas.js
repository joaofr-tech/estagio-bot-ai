const fs = require('fs');
const path = require('path');

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

function salvarNovasVagas(jsonPath) {
  if (!fs.existsSync(jsonPath)) return [];
  let candidatas = [];
  try {
    candidatas = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return [];
  }

  const banco = carregarBanco();
  const linksExistentes = new Set(banco.map(v => v.link.trim().toLowerCase()));

  const novasAdicionadas = [];
  const agora = new Date().toLocaleString('pt-BR');

  for (const vaga of candidatas) {
    if (!vaga.link) continue;
    const linkNormalizado = vaga.link.trim().toLowerCase();

    if (!linksExistentes.has(linkNormalizado)) {
      const nova = {
        id: "vaga-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5),
        empresa: vaga.empresa || "Empresa Confidencial",
        cargo: vaga.cargo || "Est?gio",
        modalidade: vaga.modalidade || "Remoto / H?brido",
        requisitos: vaga.requisitos || "Sem requisitos descritos",
        link: vaga.link.trim(),
        dataColeta: agora,
        notificada: false
      };
      banco.unshift(nova);
      linksExistentes.add(linkNormalizado);
      novasAdicionadas.push(nova);
    }
  }

  salvarBanco(banco);

  if (novasAdicionadas.length > 0) {
    console.log(`[Banco de Vagas] ${novasAdicionadas.length} nova(s) vaga(s) in?dita(s) salva(s)!`);
  } else {
    console.log("[Banco de Vagas] Nenhuma vaga in?dita encontrada nesta rodada.");
  }

  return novasAdicionadas;
}

function obterPendentes() {
  const banco = carregarBanco();
  return banco.filter(v => v.notificada === false);
}

function marcarComoNotificadas(ids) {
  const banco = carregarBanco();
  const idSet = new Set(ids);
  for (const vaga of banco) {
    if (idSet.has(vaga.id)) {
      vaga.notificada = true;
    }
  }
  salvarBanco(banco);
}

// Inicializar banco_vagas.js
salvarBanco(carregarBanco());

if (require.main === module) {
  const comando = process.argv[2];
  const param = process.argv[3];
  if (comando === 'salvar' && param) {
    salvarNovasVagas(param);
  } else if (comando === 'pendentes') {
    console.log(JSON.stringify(obterPendentes(), null, 2));
  }
}

module.exports = {
  carregarBanco,
  salvarNovasVagas,
  obterPendentes,
  marcarComoNotificadas
};
