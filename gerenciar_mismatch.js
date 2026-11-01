const fs = require('fs');
const path = require('path');

const BANCO_PATH = path.join(__dirname, 'banco_vagas.json');
const BANCO_JS_PATH = path.join(__dirname, 'banco_vagas.js');
const REGRAS_JSON_PATH = path.join(__dirname, 'regras_mismatch.json');
const REGRAS_JS_PATH = path.join(__dirname, 'regras_mismatch.js');

// Mapeamento automático de termos negativos para cada categoria de mismatch
const MAPA_TERMOS_NEGATIVOS = {
  'Suporte / Help Desk / Atendimento Operacional': [
    'suporte técnico', 'helpdesk', 'help desk', 'atendimento ao cliente', 'service desk', 'atendimento n1', 'manutenção de computadores'
  ],
  'Comercial / Vendas / SDR / Pré-vendas': [
    'sdr', 'bdr', 'prospecção', 'vendas', 'comercial', 'venda técnica', 'inside sales', 'telemarketing'
  ],
  'Stack ou Tecnologias não desejadas (Legado)': [
    'wordpress', 'joomla', 'delphi', 'cobol', 'totvs protheus', 'advpl'
  ],
  'Exigência abusiva / Pede experiência de pleno para estágio': [
    'experiência mínima de 2 anos', 'experiência sênior', 'experiência comprovada de 3 anos'
  ],
  'Presencial rígido / Localização inviável': []
};

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

function carregarRegrasMismatch() {
  if (!fs.existsSync(REGRAS_JSON_PATH)) {
    return {
      motivosFrequentes: {},
      termosNegativos: [
        'suporte técnico',
        'helpdesk',
        'service desk',
        'telemarketing',
        'sdr',
        'vendas'
      ],
      regrasExclusao: [
        'Vagas com foco em Suporte Técnico / Help Desk / Manutenção de Hardware',
        'Vagas comerciais, prospecção SDR ou vendas de software',
        'Vagas que exijam experiência prévia de pleno ou sênior para estagiário'
      ],
      descartadas: []
    };
  }
  try {
    return JSON.parse(fs.readFileSync(REGRAS_JSON_PATH, 'utf8'));
  } catch (e) {
    return { motivosFrequentes: {}, termosNegativos: [], regrasExclusao: [], descartadas: [] };
  }
}

function salvarRegrasMismatch(regras) {
  fs.writeFileSync(REGRAS_JSON_PATH, JSON.stringify(regras, null, 2), 'utf8');
  fs.writeFileSync(REGRAS_JS_PATH, `window.REGRAS_MISMATCH = ${JSON.stringify(regras, null, 2)};\n`, 'utf8');
}

/**
 * Normaliza strings para matching uniforme
 */
function normalizarTexto(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\[\]\(\)\-\_\,\.\:\/\+\&\|\!\?\#\@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Registra o descarte de uma vaga por Mismatch e extrai regras para o robô
 */
function descartarVaga(canonicalKeyOrId, motivo, detalhe = '') {
  const banco = carregarBanco();
  const regras = carregarRegrasMismatch();
  const dataHoje = new Date().toLocaleString('pt-BR');

  const cleanKey = normalizarTexto(canonicalKeyOrId);

  // Localizar a vaga no banco
  let vaga = banco.find(v => v.id === canonicalKeyOrId);
  if (!vaga) {
    vaga = banco.find(v => {
      const k = normalizarTexto(`${v.empresa}::${v.cargo}`);
      return k === cleanKey || k.includes(cleanKey);
    });
  }

  if (vaga) {
    vaga.status = 'descartada';
    vaga.motivoMismatch = motivo;
    vaga.detalheMismatch = detalhe;
    vaga.dataMismatch = dataHoje;
    salvarBanco(banco);
    console.log(`[Mismatch] Vaga '${vaga.cargo}' da empresa '${vaga.empresa}' marcada como DESCARTADA.`);
  } else {
    console.log(`[Mismatch] Vaga com chave/id '${canonicalKeyOrId}' atualizada no catálogo.`);
  }

  // Atualizar frequência do motivo
  regras.motivosFrequentes[motivo] = (regras.motivosFrequentes[motivo] || 0) + 1;

  // Adicionar termos negativos associados
  const novosTermos = MAPA_TERMOS_NEGATIVOS[motivo] || [];
  novosTermos.forEach(t => {
    if (!regras.termosNegativos.includes(t)) {
      regras.termosNegativos.push(t);
    }
  });

  // Se houver detalhe específico digitado pelo usuário, adicionar à lista de regras da IA
  if (detalhe && detalhe.trim().length > 3) {
    const regraCustom = `Evitar vagas com a restrição indicada pelo candidato: "${detalhe.trim()}"`;
    if (!regras.regrasExclusao.includes(regraCustom)) {
      regras.regrasExclusao.push(regraCustom);
    }
  }

  // Salvar no histórico de descartadas
  regras.descartadas.unshift({
    chave: canonicalKeyOrId,
    empresa: vaga ? vaga.empresa : 'N/A',
    cargo: vaga ? vaga.cargo : 'N/A',
    motivo,
    detalhe,
    data: dataHoje
  });

  // Manter no máximo as últimas 150 descartadas no log histórico
  if (regras.descartadas.length > 150) {
    regras.descartadas = regras.descartadas.slice(0, 150);
  }

  salvarRegrasMismatch(regras);
  console.log(`[Regras Mismatch] Regras atualizadas com sucesso! Total de termos negativos: ${regras.termosNegativos.length}`);

  return { sucesso: true, vaga, regras };
}

/**
 * Verifica se um texto contém termos proibidos de mismatch
 */
function verificarTermoProibido(texto) {
  const regras = carregarRegrasMismatch();
  const normal = normalizarTexto(texto);

  for (const termo of regras.termosNegativos) {
    const termoNorm = normalizarTexto(termo);
    if (normal.includes(termoNorm)) {
      return { proibido: true, termo };
    }
  }
  return { proibido: false };
}

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'descartar') {
    const key = process.argv[3];
    const motivo = process.argv[4] || 'Perfil incompatível';
    const detalhe = process.argv[5] || '';
    descartarVaga(key, motivo, detalhe);
  } else if (cmd === 'listar') {
    console.log(JSON.stringify(carregarRegrasMismatch(), null, 2));
  } else if (cmd === 'init') {
    salvarRegrasMismatch(carregarRegrasMismatch());
    console.log('Regras de mismatch inicializadas.');
  }
}

module.exports = {
  descartarVaga,
  carregarRegrasMismatch,
  salvarRegrasMismatch,
  verificarTermoProibido,
  MAPA_TERMOS_NEGATIVOS
};
