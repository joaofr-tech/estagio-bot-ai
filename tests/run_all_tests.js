const { runCandidaturasTests } = require('./candidaturas.test');
const { runIndicadoresTests } = require('./indicadores.test');
const { runParametrosTests } = require('./parametros.test');
const { runCrawlerGerenciadorTests } = require('./crawler_gerenciador.test');
const { runObservabilidadeTests } = require('./observabilidade.test');
const { runResumeEngineTests } = require('./resume_engine.test');
const { runApiAndSecurityTests } = require('./api_and_security.test');
const { runChaosTests } = require('./resume_engine.chaos.test');

async function runAll() {
  const start = Date.now();
  console.log('====================================================');
  console.log('       SUÍTE DE TESTES AUTOMATIZADOS DO PROJETO     ');
  console.log('====================================================');

  try {
    runCandidaturasTests();
    runIndicadoresTests();
    runParametrosTests();
    runCrawlerGerenciadorTests();
    runObservabilidadeTests();
    await runResumeEngineTests();
    await runApiAndSecurityTests();
    await runChaosTests();

    const elapsed = Date.now() - start;
    console.log('\n====================================================');
    console.log(`✓ TODOS OS TESTES PASSARAM COM SUCESSO! (${elapsed}ms)`);
    console.log('====================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ FALHA NOS TESTES:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runAll();
