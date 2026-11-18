const { carregarBanco, validarSchemaVaga } = require('./repository');
const { gerarChaveCanonica } = require('../gerenciador_vagas');
const { verificarTermoProibido } = require('../gerenciar_mismatch');

/**
 * Executa a etapa Transform do ETL de forma 100% determinística:
 * - Valida contrato/schema de cada vaga
 * - Deduplica dentro da própria rodada e contra o banco existente
 * - Aplica filtro preventivo de mismatch antes de qualquer persistência ou IA
 */
function filtrarETransformar(rawJobs, bancoAtual = null) {
  const listaBruta = Array.isArray(rawJobs) ? rawJobs : [];
  const banco = Array.isArray(bancoAtual) ? bancoAtual : carregarBanco();

  const chavesBanco = new Set();
  const linksBanco = new Set();

  for (const v of banco) {
    chavesBanco.add(gerarChaveCanonica(v));
    if (v.link) {
      linksBanco.add(v.link.trim().toLowerCase());
    }
  }

  const chavesRodada = new Set();
  const linksRodada = new Set();
  const ineditas = [];

  const funil = {
    extraidas: listaBruta.length,
    duplicadasRodada: 0,
    jaConhecidas: 0,
    filtradasMismatch: 0,
    invalidas: 0,
    ineditas: 0
  };

  for (const raw of listaBruta) {
    const validacao = validarSchemaVaga(raw);
    if (!validacao.valida) {
      funil.invalidas++;
      continue;
    }

    const vaga = validacao.vagaSanitizada;
    const chave = gerarChaveCanonica(vaga);
    const linkNorm = vaga.link ? vaga.link.toLowerCase() : '';

    if (chavesRodada.has(chave) || (linkNorm && linksRodada.has(linkNorm))) {
      funil.duplicadasRodada++;
      continue;
    }

    chavesRodada.add(chave);
    if (linkNorm) linksRodada.add(linkNorm);

    if (chavesBanco.has(chave) || (linkNorm && linksBanco.has(linkNorm))) {
      funil.jaConhecidas++;
      continue;
    }

    let checagemMismatch = { proibido: false };
    try {
      checagemMismatch = verificarTermoProibido(`${vaga.cargo} ${vaga.requisitos || ''}`);
    } catch (e) {}

    if (checagemMismatch.proibido) {
      funil.filtradasMismatch++;
      continue;
    }

    ineditas.push(vaga);
    funil.ineditas++;
  }

  return { ineditas, funil };
}

module.exports = {
  filtrarETransformar
};
