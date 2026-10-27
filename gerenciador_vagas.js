const fs = require('fs');
const path = require('path');

const BANCO_PATH = path.join(__dirname, 'banco_vagas.json');
const BANCO_JS_PATH = path.join(__dirname, 'banco_vagas.js');

/**
 * Normaliza strings removendo acentos, pontuações especiais, stop-words
 * para permitir identificação precisa de vagas duplicadas mesmo com pequenas variações.
 */
function normalizarTexto(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\[\]\(\)\-\_\,\.\:\/\+\&\|\!\?\#\@]/g, ' ')
    .replace(/\b(de|do|da|dos|das|em|para|com|e|bh|mg|remoto|hibrido|estagio|estagiario|estagiaria)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Gera uma chave canônica determinística para a vaga baseada em Empresa + Cargo
 */
function gerarChaveCanonica(vaga) {
  const emp = normalizarTexto(vaga.empresa);
  const car = normalizarTexto(vaga.cargo);
  return `${emp}::${car}`;
}

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
 * Executa uma faxina profunda no banco, condensando duplicatas acumuladas
 */
function limparDuplicatas() {
  const banco = carregarBanco();
  const mapa = new Map();
  let duplicatas = 0;

  for (const vaga of banco) {
    const chave = gerarChaveCanonica(vaga);
    if (!mapa.has(chave)) {
      mapa.set(chave, {
        ...vaga,
        status: vaga.status || 'para_aplicar'
      });
    } else {
      duplicatas++;
      const existente = mapa.get(chave);
      // Preservar informações úteis
      if (vaga.notificada) existente.notificada = true;
      if (vaga.status && vaga.status !== 'para_aplicar') existente.status = vaga.status;
      if (!existente.link && vaga.link) existente.link = vaga.link;
    }
  }

  const limpo = Array.from(mapa.values());
  salvarBanco(limpo);
  console.log(`[Deduplicação] Limpeza concluída: ${duplicatas} duplicata(s) removida(s). Total único restante: ${limpo.length}`);
  return limpo;
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
  
  // Indexar chaves canônicas existentes e links conhecidos
  const chavesExistentes = new Set();
  const linksExistentes = new Set();

  for (const v of banco) {
    chavesExistentes.add(gerarChaveCanonica(v));
    if (v.link) {
      linksExistentes.add(v.link.trim().toLowerCase());
    }
  }

  const novasAdicionadas = [];
  const agora = new Date().toLocaleString('pt-BR');

  for (const vaga of candidatas) {
    if (!vaga.empresa && !vaga.cargo) continue;

    const chave = gerarChaveCanonica(vaga);
    const linkNormalizado = vaga.link ? vaga.link.trim().toLowerCase() : '';

    // Verifica tanto por chave canônica (Empresa+Cargo) quanto por link direto
    const jaExiste = chavesExistentes.has(chave) || (linkNormalizado && linksExistentes.has(linkNormalizado));

    if (!jaExiste) {
      const nova = {
        id: "vaga-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5),
        empresa: vaga.empresa || "Empresa Confidencial",
        cargo: vaga.cargo || "Estágio",
        modalidade: vaga.modalidade || "Remoto / Híbrido",
        requisitos: vaga.requisitos || "Sem requisitos descritos",
        link: vaga.link ? vaga.link.trim() : "",
        dataColeta: agora,
        notificada: false,
        status: 'para_aplicar' // para_aplicar, aplicada, favorita, encerrada, descartada
      };
      banco.unshift(nova);
      chavesExistentes.add(chave);
      if (linkNormalizado) linksExistentes.add(linkNormalizado);
      novasAdicionadas.push(nova);
    }
  }

  salvarBanco(banco);

  if (novasAdicionadas.length > 0) {
    console.log(`[Banco de Vagas] ${novasAdicionadas.length} nova(s) vaga(s) inédita(s) salva(s)!`);
  } else {
    console.log("[Banco de Vagas] Nenhuma vaga inédita encontrada nesta rodada (todas já catalogadas).");
  }

  return novasAdicionadas;
}

function obterPendentes() {
  const banco = carregarBanco();
  return banco.filter(v => v.notificada === false && v.status !== 'encerrada' && v.status !== 'descartada');
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

function atualizarStatusVaga(id, novoStatus) {
  const banco = carregarBanco();
  const vaga = banco.find(v => v.id === id);
  if (vaga) {
    vaga.status = novoStatus;
    if (novoStatus === 'aplicada') {
      vaga.dataAplicacao = new Date().toLocaleString('pt-BR');
    }
    salvarBanco(banco);
    return true;
  }
  return false;
}

if (require.main === module) {
  const comando = process.argv[2];
  const param = process.argv[3];
  if (comando === 'salvar' && param) {
    salvarNovasVagas(param);
  } else if (comando === 'pendentes') {
    console.log(JSON.stringify(obterPendentes(), null, 2));
  } else if (comando === 'limpar') {
    limparDuplicatas();
  }
}

module.exports = {
  carregarBanco,
  salvarBanco,
  salvarNovasVagas,
  obterPendentes,
  marcarComoNotificadas,
  limparDuplicatas,
  atualizarStatusVaga,
  gerarChaveCanonica,
  normalizarTexto
};
