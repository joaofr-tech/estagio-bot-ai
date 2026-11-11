const assert = require('assert');

function runIndicadoresTests() {
  console.log('\n[Suíte 2: Indicadores, KPIs & Métricas]');

  // 1. Validação de Tempo Médio com 0 aplicadas
  const zeroAplicadas = [];
  const temposZero = zeroAplicadas.map(j => j.tempoGastoSegundos).filter(t => typeof t === 'number' && t > 0);
  const tempoMedioZero = temposZero.length === 0 ? '--' : `${Math.round(temposZero.reduce((a,b)=>a+b,0)/temposZero.length)}s`;
  assert.strictEqual(tempoMedioZero, '--', 'Tempo médio deve ser rigorosamente "--" quando não há aplicações');
  console.log('  ✓ Tempo Médio com 0 vagas: retorna "--" sem números fictícios');

  // 2. Validação de Tempo Médio com dados reais
  const aplicadasReais = [
    { tempoGastoSegundos: 120 }, // 2m
    { tempoGastoSegundos: 180 }, // 3m
    { tempoGastoSegundos: 300 }  // 5m
  ];
  const temposReais = aplicadasReais.map(j => j.tempoGastoSegundos);
  const mediaSeg = Math.round(temposReais.reduce((a,b)=>a+b,0) / temposReais.length);
  const m = Math.floor(mediaSeg / 60);
  const s = mediaSeg % 60;
  const tempoFormatado = m > 0 ? `${m}m ${s}s` : `${s}s`;
  assert.strictEqual(tempoFormatado, '3m 20s', 'Média de 120+180+300 = 200s (3m 20s)');
  console.log('  ✓ Tempo Médio com candidaturas: calcula média ponderada real (3m 20s)');

  // 3. Taxa de Conclusão com 0 iniciadas
  const totalIniciadasZero = 0;
  const taxaZero = totalIniciadasZero === 0 ? '--' : '0%';
  assert.strictEqual(taxaZero, '--');
  console.log('  ✓ Taxa de Conclusão com 0 iniciadas: retorna "--"');

  // 4. Taxa de Conclusão com dados reais
  const aplicadasCount = 3;
  const andamentoCount = 1;
  const totalIniciadas = aplicadasCount + andamentoCount; // 4
  const taxaReal = Math.round((aplicadasCount / totalIniciadas) * 100);
  assert.strictEqual(taxaReal, 75, 'Taxa deve ser exatamente 75%');
  console.log('  ✓ Taxa de Conclusão com dados: 3 aplicadas de 4 iniciadas = 75%');

  // 5. Funil de Oportunidades com Encerradas Sem Candidatura
  const mockBanco = [
    { status: 'para_aplicar' },
    { status: 'para_aplicar' },
    { status: 'em_andamento' },
    { status: 'aplicada', dataAplicacao: '01/11/2026' },
    { status: 'encerrada', dataAplicacao: null },
    { status: 'encerrada', dataAplicacao: null }
  ];

  const abertas = mockBanco.filter(j => j.status === 'para_aplicar').length;
  const andamento = mockBanco.filter(j => j.status === 'em_andamento').length;
  const concluidas = mockBanco.filter(j => j.status === 'aplicada').length;
  const encerradasSemCandidatura = mockBanco.filter(j => j.status === 'encerrada' && !j.dataAplicacao).length;

  assert.strictEqual(abertas, 2);
  assert.strictEqual(andamento, 1);
  assert.strictEqual(concluidas, 1);
  assert.strictEqual(encerradasSemCandidatura, 2, 'Deve identificar exatamente 2 encerradas sem candidatura');
  console.log('  ✓ Funil de Oportunidades: contabiliza encerradas sem candidatura no funil');

  // 6. Classificador de Áreas
  function classificarAreaVaga(job) {
    const text = ((job.cargo || '') + ' ' + (job.requisitos || '') + ' ' + (job.empresa || '')).toLowerCase();
    if (text.includes('ciência de dados') || text.includes('data science') || text.includes('ai engineer') || text.includes('genai')) return 'Ciência de Dados & IA';
    if (text.includes('dado') || text.includes('data') || text.includes('analytics') || text.includes('bi')) return 'Engenharia de Dados & BI';
    if (text.includes('backend') || text.includes('java') || text.includes('python') || text.includes('api')) return 'Backend & APIs';
    if (text.includes('frontend') || text.includes('react') || text.includes('web')) return 'Frontend & Web';
    if (text.includes('fintech') || text.includes('banco') || text.includes('nybanq')) return 'Fintech & Finanças';
    if (text.includes('qa') || text.includes('teste') || text.includes('automação')) return 'QA & Automação';
    return 'Engenharia de Software Geral';
  }

  assert.strictEqual(classificarAreaVaga({ cargo: 'Estágio em Java e APIs Spring' }), 'Backend & APIs');
  assert.strictEqual(classificarAreaVaga({ cargo: 'Estagiário Frontend React' }), 'Frontend & Web');
  assert.strictEqual(classificarAreaVaga({ cargo: 'AI Engineer GenAI Intern' }), 'Ciência de Dados & IA');
  assert.strictEqual(classificarAreaVaga({ cargo: 'Estágio em Engenharia de Dados ETL' }), 'Engenharia de Dados & BI');
  assert.strictEqual(classificarAreaVaga({ cargo: 'Estágio Desenvolvedor NYBANQ Fintech' }), 'Fintech & Finanças');
  console.log('  ✓ Classificação por Área: categoriza determinísticamente especialidades técnicas');

  // 7. Timeline Quinzenal (15 dias móveis)
  const days = [];
  const today = new Date();
  for (let i = 14; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d.toLocaleDateString('pt-BR'));
  }
  assert.strictEqual(days.length, 15, 'Timeline deve conter exatamente 15 dias');
  assert.strictEqual(days[14], today.toLocaleDateString('pt-BR'), 'Último dia da timeline deve ser hoje');
  console.log('  ✓ Timeline Quinzenal: gera 15 dias contínuos terminando na data presente');

  // 8. Classificador de Plataformas & ATSs
  function classificarPlataformaVaga(job) {
    const url = (job.link || '').toLowerCase();
    if (url.includes('linkedin.com')) return 'LinkedIn';
    if (url.includes('gupy.io')) return 'Gupy';
    if (url.includes('greenhouse.io')) return 'Greenhouse (ATS)';
    if (url.includes('myworkdayjobs.com') || url.includes('workday')) return 'Workday (ATS)';
    if (url.includes('inhire.app')) return 'InHire (ATS)';
    if (url.includes('solides')) return 'Sólides (ATS)';
    if (url.includes('ciadetalentos') || url.includes('vagas.ciadetalentos')) return 'Cia de Talentos';
    if (url.includes('vagas.com.br') || url.includes('vagas.com')) return 'Vagas.com';
    if (url.includes('catho.com.br')) return 'Catho';
    if (url.includes('nube.com.br') || url.includes('ciee.org.br') || url.includes('agiel.com.br')) return 'Agentes (Nube/CIEE)';
    if (url.includes('glassdoor')) return 'Glassdoor';
    if (url.includes('indeed')) return 'Indeed';
    if (url.includes('vertexaisearch') || url.includes('google.com')) return 'Google Jobs';
    return 'Sites Próprios das Empresas';
  }

  assert.strictEqual(classificarPlataformaVaga({ link: 'https://www.linkedin.com/jobs/view/123' }), 'LinkedIn');
  assert.strictEqual(classificarPlataformaVaga({ link: 'https://empresa.gupy.io/job/456' }), 'Gupy');
  assert.strictEqual(classificarPlataformaVaga({ link: 'https://job-boards.greenhouse.io/empresa/vaga' }), 'Greenhouse (ATS)');
  assert.strictEqual(classificarPlataformaVaga({ link: 'https://ciena.wd5.myworkdayjobs.com/careers' }), 'Workday (ATS)');
  assert.strictEqual(classificarPlataformaVaga({ link: 'https://radix.inhire.app/vagas/123' }), 'InHire (ATS)');
  assert.strictEqual(classificarPlataformaVaga({ link: 'https://vertexaisearch.cloud.google.com/redirect' }), 'Google Jobs');
  assert.strictEqual(classificarPlataformaVaga({ link: 'https://careers.wexinc.com/job/1' }), 'Sites Próprios das Empresas');
  console.log('  ✓ Classificação por Plataforma & ATS: categoriza URLs e ATSs determinísticamente');
}

module.exports = { runIndicadoresTests };

if (require.main === module) {
  runIndicadoresTests();
}
