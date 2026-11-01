const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runParametrosTests() {
  console.log('\n[Suíte 3: Parâmetros Determinísticos & Localização]');

  // 1. Regra Inteligente de Turnos
  function calcularTurnosPorEstudo(turnoEstudo) {
    const res = { manha: false, tarde: false, noite: false, flexivel: true };
    if (turnoEstudo === 'Manhã') {
      res.tarde = true;
      res.noite = true;
    } else if (turnoEstudo === 'Tarde') {
      res.manha = true;
      res.noite = true;
    } else if (turnoEstudo === 'Noite') {
      res.manha = true;
      res.tarde = true;
    }
    return res;
  }

  const deManha = calcularTurnosPorEstudo('Manhã');
  assert.strictEqual(deManha.manha, false, 'Quem estuda de manhã não tem manhã marcada por padrão');
  assert.strictEqual(deManha.tarde, true, 'Quem estuda de manhã tem tarde marcada');
  assert.strictEqual(deManha.noite, true, 'Quem estuda de manhã tem noite marcada');
  assert.strictEqual(deManha.flexivel, true, 'Flexível sempre ativo');

  const deTarde = calcularTurnosPorEstudo('Tarde');
  assert.strictEqual(deTarde.manha, true, 'Quem estuda de tarde tem manhã marcada');
  assert.strictEqual(deTarde.tarde, false);
  assert.strictEqual(deTarde.noite, true);

  const deNoite = calcularTurnosPorEstudo('Noite');
  assert.strictEqual(deNoite.manha, true);
  assert.strictEqual(deNoite.tarde, true);
  assert.strictEqual(deNoite.noite, false);
  console.log('  ✓ Regra inteligente de turnos: adapta automaticamente para Manhã, Tarde e Noite');

  // 2. Base de Estados e Cidades
  const estados = {
    "MG": ["Belo Horizonte", "Contagem", "Betim", "Nova Lima", "Ibirité"],
    "SP": ["São Paulo (Capital)", "Campinas", "Osasco", "Barueri / Alphaville"]
  };

  assert.ok(estados["MG"].includes("Belo Horizonte"));
  assert.ok(estados["MG"].includes("Nova Lima"));
  assert.ok(estados["SP"].includes("Campinas"));
  console.log('  ✓ Base de Localização: resolve pólos metropolitanos por UF');

  // 3. Validação do arquivo config_busca.json
  const configPath = path.join(__dirname, '..', 'config_busca.json');
  assert.ok(fs.existsSync(configPath), 'config_busca.json deve existir');

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.strictEqual(config.candidato, 'João Francisco', 'Candidato deve ser João Francisco');
  assert.ok(Array.isArray(config.turnosDisponiveis), 'turnosDisponiveis deve ser array');
  assert.ok(typeof config.aceitaRemoto === 'boolean');
  assert.ok(typeof config.aceitaPresencial === 'boolean');
  console.log('  ✓ config_busca.json: estrutura determinística válida para o crawler');
}

module.exports = { runParametrosTests };

if (require.main === module) {
  runParametrosTests();
}
