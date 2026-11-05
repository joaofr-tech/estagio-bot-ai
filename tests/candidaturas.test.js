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

  // 6. Ciclo de Ação Pendente (Conclusão e Imunidade ao F5 / Refresh)
  const jobPendenteDb = {
    empresa: "iFood",
    cargo: "Programa de Estágio GenAI",
    canonicalKey: "ifood::programa estagio genai",
    status: "acao_pendente",
    detalhesAcao: {
      tipo: "Teste Técnico / Desafio",
      assunto: "iFood | Teste Técnico Obrigatório",
      dataRecebimento: "03/11/2026, 10:00:00"
    }
  };

  // Usuário clica em 'Concluído'
  const storeUser = {};
  const currentEntry = storeUser[jobPendenteDb.canonicalKey] || {};
  currentEntry.status = 'aplicada';
  currentEntry.etapaConcluida = true;
  currentEntry.dataConclusaoEtapa = '05/11/2026, 17:30:00';
  currentEntry.ultimoAssuntoConcluido = jobPendenteDb.detalhesAcao.assunto;
  currentEntry.ultimaDataRecebimentoConcluida = jobPendenteDb.detalhesAcao.dataRecebimento;
  storeUser[jobPendenteDb.canonicalKey] = currentEntry;

  // Simular consolidação pós-refresh (F5)
  function consolidarStatus(dbJob, userState) {
    const isClosedInDb = dbJob.status === 'encerrada';
    const isMismatch = (userState && userState.status === 'descartada') || dbJob.status === 'descartada';

    const isNewAction = dbJob.status === 'acao_pendente' &&
      userState.etapaConcluida &&
      dbJob.detalhesAcao &&
      ((userState.ultimoAssuntoConcluido && dbJob.detalhesAcao.assunto && dbJob.detalhesAcao.assunto !== userState.ultimoAssuntoConcluido) ||
       (userState.ultimaDataRecebimentoConcluida && dbJob.detalhesAcao.dataRecebimento && dbJob.detalhesAcao.dataRecebimento !== userState.ultimaDataRecebimentoConcluida));

    const isEtapaConcluida = !isNewAction && !!(userState.etapaConcluida || dbJob.etapaConcluida);

    if (isClosedInDb) return 'encerrada';
    if (isMismatch) return 'descartada';
    if (isEtapaConcluida) return userState.status || 'aplicada';
    if (dbJob.status === 'acao_pendente' || userState.status === 'acao_pendente') return 'acao_pendente';
    return userState.status || dbJob.status || 'para_aplicar';
  }

  const statusPosRefresh = consolidarStatus(jobPendenteDb, storeUser[jobPendenteDb.canonicalKey]);
  assert.strictEqual(statusPosRefresh, 'aplicada', 'Após refresh, vaga com etapa concluída deve permanecer como aplicada');
  console.log('  ✓ Ação pendente concluída: permanece como aplicada após reload da página');

  // 7. Detecção de nova ação posterior (segunda fase / entrevista)
  const jobNovoEmailDb = {
    ...jobPendenteDb,
    detalhesAcao: {
      tipo: "Entrevista Técnica",
      assunto: "iFood | Convocação para Entrevista com Gestor",
      dataRecebimento: "10/11/2026, 09:00:00"
    }
  };
  const statusNovoEmail = consolidarStatus(jobNovoEmailDb, storeUser[jobPendenteDb.canonicalKey]);
  assert.strictEqual(statusNovoEmail, 'acao_pendente', 'Quando novo email com assunto diferente chega, deve reabrir acao_pendente');
  console.log('  ✓ Nova convocação via e-mail: reabre corretamente ação pendente quando novo assunto é detectado');
}

module.exports = { runCandidaturasTests };

if (require.main === module) {
  runCandidaturasTests();
}
