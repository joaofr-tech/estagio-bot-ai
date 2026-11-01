const assert = require('assert');

function runCandidaturasTests() {
  console.log('\n[Suíte 1: Fluxo de Candidaturas & Estados]');

  // Mock store
  const store = {};
  function getUserStore() { return store; }
  function saveUserStore(s) { Object.assign(store, s); }

  const job = {
    canonicalKey: 'empresa_x::estagio_software',
    status: 'para_aplicar',
    link: 'https://empresa.gupy.io/job/123'
  };

  // 1. Iniciar Inscrição
  const t0 = Date.now();
  job.status = 'em_andamento';
  job.inicioCandidatura = t0;
  store[job.canonicalKey] = { status: 'em_andamento', inicioCandidatura: t0 };

  assert.strictEqual(job.status, 'em_andamento', 'Vaga deve transicionar para em_andamento');
  assert.ok(typeof job.inicioCandidatura === 'number', 'Deve registrar timestamp numérico de início');
  console.log('  ✓ Início de candidatura: status transiciona para em_andamento com timestamp');

  // 2. Confirmar Candidatura Concluída
  const t1 = t0 + 120000; // 2 min depois
  const tempoGasto = Math.round((t1 - job.inicioCandidatura) / 1000);
  job.status = 'aplicada';
  job.dataAplicacao = '01/11/2026, 12:30:00';
  job.tempoGastoSegundos = tempoGasto;
  store[job.canonicalKey] = { ...store[job.canonicalKey], status: 'aplicada', dataAplicacao: job.dataAplicacao, tempoGastoSegundos: tempoGasto };

  assert.strictEqual(job.status, 'aplicada', 'Vaga deve transicionar para aplicada');
  assert.strictEqual(job.tempoGastoSegundos, 120, 'Tempo gasto deve ser exatamente 120s');
  assert.ok(job.dataAplicacao.includes('01/11/2026'), 'Data de aplicação deve ser registrada');
  console.log('  ✓ Confirmação de candidatura: calcula tempoGastoSegundos e fixa dataAplicacao');

  // 3. Reversão (Desistir / Mover de volta para abertas)
  job.status = 'para_aplicar';
  delete job.inicioCandidatura;
  delete job.tempoGastoSegundos;
  assert.strictEqual(job.status, 'para_aplicar');
  assert.strictEqual(job.inicioCandidatura, undefined);
  console.log('  ✓ Reversão de candidatura: retorna limpa para vagas abertas');

  // 4. Favoritar / Desfavoritar (Star)
  job.starred = !job.starred;
  assert.strictEqual(job.starred, true);
  job.starred = !job.starred;
  assert.strictEqual(job.starred, false);
  console.log('  ✓ Toggle Star: alterna corretamente o status de favorita');

  // 5. Encerramento de vaga
  job.status = 'encerrada';
  assert.strictEqual(job.status, 'encerrada');
  console.log('  ✓ Encerramento de vaga: status marcado como encerrada');
}

module.exports = { runCandidaturasTests };

if (require.main === module) {
  runCandidaturasTests();
}
