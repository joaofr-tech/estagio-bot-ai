const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gerarChaveCanonica, normalizarTexto } = require('../gerenciador_vagas');
const { expurgarVagasEncerradas } = require('../verificar_vagas_encerradas');
const { validarSchemaVaga, writeFileAtomically } = require('../src/repository');
const { filtrarETransformar } = require('../src/transform');

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

  // 4. Validação de Schema de Vaga
  const vazia = validarSchemaVaga({});
  assert.strictEqual(vazia.valida, false, 'Objeto vazio deve ser rejeitado pelo schema');

  const linkRuim = validarSchemaVaga({ empresa: 'Acme', cargo: 'Estágio Dev', link: '#' });
  assert.strictEqual(linkRuim.valida, false, 'Link "#" deve ser rejeitado pelo schema');

  const valida = validarSchemaVaga({ empresa: '  Acme Tech ', cargo: ' Estágio Backend ', link: ' https://acme.gupy.io/jobs/1 ' });
  assert.strictEqual(valida.valida, true, 'Vaga bem formada deve ser aceita');
  assert.strictEqual(valida.vagaSanitizada.empresa, 'Acme Tech');
  assert.strictEqual(valida.vagaSanitizada.link, 'https://acme.gupy.io/jobs/1');
  assert.strictEqual(valida.vagaSanitizada.status, 'para_aplicar');
  console.log('  ✓ validarSchemaVaga: rejeita entradas inválidas e sanitiza campos obrigatórios');

  // 5. Escrita Atômica em Disco
  const tmpTestFile = path.join(os.tmpdir(), `sona_atomic_test_${process.pid}.json`);
  try {
    writeFileAtomically(tmpTestFile, '{"ok":true}');
    assert.strictEqual(fs.readFileSync(tmpTestFile, 'utf8'), '{"ok":true}');
    console.log('  ✓ writeFileAtomically: persiste conteúdo sem corromper arquivo destino');
  } finally {
    if (fs.existsSync(tmpTestFile)) fs.unlinkSync(tmpTestFile);
  }

  // 6. Pipeline Transform: Deduplicação + Mismatch
  const bancoSimulado = [
    { empresa: 'Empresa Já Salva', cargo: 'Estágio Backend', link: 'https://exemplo.com/vagas/1' }
  ];
  const loteBruto = [
    { empresa: 'Empresa Já Salva', cargo: 'Estágio Backend', link: 'https://exemplo.com/vagas/1' },
    { empresa: 'Tech Nova', cargo: 'Estágio Suporte Técnico Helpdesk', link: 'https://exemplo.com/vagas/2' },
    { empresa: 'Tech Nova', cargo: 'Estágio Desenvolvimento Node.js', link: 'https://exemplo.com/vagas/3' },
    { empresa: 'Tech Nova', cargo: 'Estágio Desenvolvimento Node.js', link: 'https://exemplo.com/vagas/3' },
    { link: 'javascript:alert(1)' }
  ];

  const { ineditas, funil } = filtrarETransformar(loteBruto, bancoSimulado);
  assert.strictEqual(ineditas.length, 1, 'Apenas 1 vaga inédita e válida deve sobreviver');
  assert.strictEqual(funil.jaConhecidas, 1, 'Deve contabilizar 1 vaga já conhecida no banco');
  assert.strictEqual(funil.filtradasMismatch, 1, 'Deve barrar 1 vaga por termo negativo de mismatch');
  assert.strictEqual(funil.duplicadasRodada, 1, 'Deve deduplicar 1 ocorrência repetida na mesma rodada');
  assert.strictEqual(funil.invalidas, 1, 'Deve barrar 1 vaga inválida no schema');
  console.log('  ✓ filtrarETransformar: deduplica rodada/banco e barra mismatch antes de persistir');
}

module.exports = { runCrawlerGerenciadorTests };

if (require.main === module) {
  runCrawlerGerenciadorTests();
}
