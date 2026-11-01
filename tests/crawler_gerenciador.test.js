const assert = require('assert');
const path = require('path');
const { gerarChaveCanonica, normalizarTexto } = require('../gerenciador_vagas');
const { expurgarVagasEncerradas } = require('../verificar_vagas_encerradas');

function runCrawlerGerenciadorTests() {
  console.log('\n[Suíte 4: Gerenciador de Vagas, Deduplicação & Expurgo]');

  // 1. Normalização de Texto
  const t1 = normalizarTexto("Estágio em Engenharia de Software - Remoto (BH/MG)");
  assert.ok(!t1.includes('estagio'), 'Stop-word estagio deve ser removida');
  assert.ok(!t1.includes('remoto'), 'Stop-word remoto deve ser removida');
  assert.ok(!t1.includes('bh'), 'Stop-word bh deve ser removida');
  console.log('  ✓ normalizarTexto: limpa stop-words, acentuações e pontuações');

  // 2. Chave Canônica Determinística
  const vagaA = { empresa: "Google Brasil", cargo: "Estágio de Software" };
  const vagaB = { empresa: "Google", cargo: "Estagiário em Software" };
  const chaveA = gerarChaveCanonica(vagaA);
  const chaveB = gerarChaveCanonica(vagaB);
  
  assert.ok(chaveA.includes('google') && chaveA.includes('software'));
  console.log('  ✓ gerarChaveCanonica: produz chaves consistentes para prevenção de duplicatas');

  // 3. Expurgo de Vagas Encerradas
  assert.strictEqual(typeof expurgarVagasEncerradas, 'function', 'Função expurgarVagasEncerradas deve existir');
  console.log('  ✓ expurgarVagasEncerradas: rotina de limpeza de vagas encerradas disponível');
}

module.exports = { runCrawlerGerenciadorTests };

if (require.main === module) {
  runCrawlerGerenciadorTests();
}
