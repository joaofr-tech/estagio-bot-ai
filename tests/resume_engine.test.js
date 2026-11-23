const assert = require('assert');
const {
  detectJobLanguage,
  compactJobDescription,
  detectUnverifiedMetrics,
  buildSkillsWhitelist,
  selectTopProjectsDeterministically,
  enforceDeterministicGuardrails,
  generateTruthfulATSResume
} = require('../api/_lib/resume_engine');
const { parseLinkedInFiles } = require('../api/_lib/linkedin_parser');

const SAMPLE_PROFILE = {
  basics: {
    name: 'João Francisco',
    email: 'joao@exemplo.com',
    location: 'Belo Horizonte, MG',
    github: 'https://github.com/joao'
  },
  education: [
    {
      id: 'edu-1',
      institution: 'PUC Minas',
      degree: 'Bacharelado em Engenharia de Software',
      field: '3º período',
      start_date: '2025',
      end_date: '2028',
      highlights: []
    }
  ],
  experiences: [],
  projects: [
    {
      id: 'proj-sona',
      name: 'Sona ETL',
      url: 'https://github.com/joao/sona',
      languages: ['Python', 'JavaScript'],
      verified_skills: ['Python', 'Pydantic', 'Supabase', 'PostgreSQL'],
      readme_summary: 'Pipeline ETL paralelo em Python com painel web interativo para acompanhar vagas.',
      facts: [
        'Coleta vagas em 5 portais usando Python e httpx.',
        'Interface web usada para organizar candidaturas em funil.'
      ]
    },
    {
      id: 'proj-api',
      name: 'TaskFlow API',
      url: 'https://github.com/joao/taskflow',
      languages: ['JavaScript', 'SQL'],
      verified_skills: ['Node.js', 'SQL', 'REST API'],
      readme_summary: 'API REST em Node.js para gestão de tarefas.',
      facts: ['Construiu endpoints REST em Node.js e consultas SQL.']
    },
    {
      id: 'proj-calc',
      name: 'CalcCLI',
      url: 'https://github.com/joao/calc',
      languages: ['C'],
      verified_skills: ['C'],
      readme_summary: 'Calculadora simples de terminal em C.',
      facts: ['Implementou operações matemáticas básicas em C.']
    },
    {
      id: 'proj-old',
      name: 'LandingPageStatic',
      url: 'https://github.com/joao/landing',
      languages: ['HTML', 'CSS'],
      verified_skills: ['HTML', 'CSS'],
      readme_summary: 'Página estática de portfólio.',
      facts: ['Layout responsivo em HTML e CSS.']
    }
  ],
  skills_whitelist: ['Python', 'JavaScript', 'SQL', 'Git']
};

async function runResumeEngineTests() {
  console.log('\n--- Testes: Sona Resume Studio (Motor ATS Anti-Alucinação & LinkedIn Parser) ---');

  // 1. Detecção automática de idioma
  assert.strictEqual(
    detectJobLanguage('Estágio em Engenharia de Software. Requisitos: Python, SQL e Git.'),
    'pt-BR',
    'Deve detectar PT-BR para vaga em português'
  );
  assert.strictEqual(
    detectJobLanguage('Software Engineering Intern. Requirements: Python, distributed systems, pursuing bachelor degree.'),
    'en',
    'Deve detectar EN para vaga em inglês'
  );
  console.log('  ✓ Detecção automática de idioma (PT-BR / EN)');

  // 2. Whitelist determinística agrega skills_whitelist + languages + verified_skills
  const wl = buildSkillsWhitelist(SAMPLE_PROFILE);
  assert.ok(wl.includes('Python') && wl.includes('PostgreSQL') && wl.includes('Node.js'));
  assert.ok(!wl.includes('Kubernetes') && !wl.includes('Rust'));
  console.log('  ✓ Whitelist determinística de skills');

  // 3. Seleção determinística Top 3 (mesmo em baixo fit como Product Engineer)
  const top3 = selectTopProjectsDeterministically(
    SAMPLE_PROFILE.projects,
    'Product Engineer Intern: React, TypeScript, Figma, Python, user-facing web product',
    ['Product Engineer', 'React', 'Python', 'web'],
    3
  );
  assert.strictEqual(top3.length, 3, 'Deve limitar seleção para no máximo 3 projetos');
  assert.strictEqual(top3[0].project.id, 'proj-sona', 'Sona ETL (Python + web) deve ficar em 1º lugar');
  console.log('  ✓ Seleção determinística Top 2–3 projetos (incluindo cenário Product Engineer)');

  // 4. Guardrails determinísticos bloqueiam skills inventadas, contaminação cruzada e alteração de formação
  const maliciousResume = {
    idioma: 'pt-BR',
    summary: 'Estudante focado em Kubernetes e Python.',
    education: [{ id: 'fake', institution: 'MIT', degree: 'PhD' }],
    experiences: [],
    projects: [
      {
        id: 'proj-sona',
        name: 'Sona ETL',
        tech_stack: ['Python', 'Kubernetes', 'Rust'],
        bullets: [
          { text: 'Usou Python e integração com TaskFlow API e Kubernetes.', evidence_quote: 'Coleta vagas' }
        ]
      }
    ],
    skills_grouped: [
      { category: 'Backend', items: ['Python', 'Kubernetes', 'Rust', 'SQL'] }
    ]
  };

  const { resume: guarded, guardrails } = enforceDeterministicGuardrails({
    resume: maliciousResume,
    profile: SAMPLE_PROFILE,
    matchMatrix: {
      whitelist: wl,
      excluded_gaps: ['Kubernetes', 'Rust']
    }
  });

  // Skills fora da whitelist devem ser removidas
  const keptSkills = guarded.skills_grouped.flatMap((g) => g.items);
  assert.ok(keptSkills.includes('Python') && keptSkills.includes('SQL'));
  assert.ok(!keptSkills.includes('Kubernetes') && !keptSkills.includes('Rust'));
  assert.ok(guardrails.blocked_skills.includes('Kubernetes'));
  // Tech stack do projeto também bloqueia Kubernetes/Rust
  assert.deepStrictEqual(guarded.projects[0].tech_stack, ['Python']);
  // Formação falsa ("MIT PhD") deve ser restaurada para "PUC Minas"
  assert.strictEqual(guardrails.education_restored, true);
  assert.strictEqual(guarded.education[0].institution, 'PUC Minas');
  // Contaminação cruzada ("TaskFlow API" citado dentro de "Sona ETL") deve ser detectada
  assert.strictEqual(guardrails.cross_project_warnings.length, 1);
  // Gap violation ("Kubernetes") deve ser detectada
  assert.ok(guardrails.gap_violations.length >= 1);
  console.log('  ✓ Guardrails determinísticos (Whitelist, Imutabilidade da Formação, Cross-Project e Gaps)');

  // 5. Pipeline completo 3 camadas com LLM mockado (verifica isolamento por projeto + Critic corrigindo métrica inventada)
  const isolatedProjectPrompts = [];
  const mockLlmCaller = async ({ systemPrompt, userPrompt }) => {
    if (userPrompt.includes('VAGA ALVO:')) {
      return {
        target_role: 'Product Engineer Intern',
        ats_keywords: ['Python', 'Web', 'Product', 'React'],
        direct_matches: ['Python', 'JavaScript'],
        terminological_matches: [
          {
            jd_term: 'Product Engineering',
            candidate_evidence: 'Interface web usada para organizar candidaturas em funil.',
            safe_framing: 'Desenvolvimento de interface orientada ao fluxo do usuário final'
          }
        ],
        excluded_gaps: ['React', 'Kubernetes'],
        fit_summary: 'Fit parcial: forte base em Python/web, sem React/Kubernetes.'
      };
    }
    if (userPrompt.includes('PROJETO ISOLADO')) {
      isolatedProjectPrompts.push(userPrompt);
      const isSona = userPrompt.includes('proj-sona');
      return {
        project_id: isSona ? 'proj-sona' : 'proj-api',
        name: isSona ? 'Sona ETL' : 'TaskFlow API',
        tech_stack: isSona ? ['Python', 'React'] : ['Node.js', 'SQL'],
        bullets: [
          {
            text: isSona
              ? 'Desenvolveu pipeline em Python que reduziu custos em 75%.'
              : 'Construiu endpoints REST em Node.js e consultas SQL.',
            evidence_quote: isSona
              ? 'Coleta vagas em 5 portais usando Python e httpx.'
              : 'Construiu endpoints REST em Node.js e consultas SQL.'
          }
        ]
      };
    }
    if (userPrompt.includes('SKILLS WHITELIST')) {
      return {
        summary: 'Estudante de Engenharia de Software com projetos em Python e JavaScript.',
        skills_grouped: [{ category: 'Linguagens', items: ['Python', 'JavaScript', 'React'] }]
      };
    }
    if (userPrompt.includes('BULLETS PARA AUDITORIA')) {
      return {
        results: [
          {
            ref: 'project:proj-sona:0',
            verdict: 'corrected',
            reason: 'Percentual 75% não existe na evidência original.',
            corrected_text: 'Desenvolveu pipeline em Python para coleta automatizada de vagas em 5 portais.'
          }
        ]
      };
    }
    return {};
  };

  const pipelineResult = await generateTruthfulATSResume({
    profile: SAMPLE_PROFILE,
    job: { empresa: 'Startup X', cargo: 'Product Engineer Intern', requisitos: 'Python, React, Kubernetes, Web product' },
    llmConfig: { provider: 'gemini', apiKey: 'mock-key' },
    llmCaller: mockLlmCaller,
    isolated: true
  });

  // Garante que houve chamadas isoladas por projeto (Top 3)
  assert.strictEqual(isolatedProjectPrompts.length, 3, 'Cada um dos 3 projetos deve ter sua própria chamada isolada');
  assert.ok(!isolatedProjectPrompts[0].includes('TaskFlow API'), 'Prompt do Projeto 1 não pode conter fatos do Projeto 2');
  // Garante que React foi bloqueado das skills e do tech_stack
  const finalSkills = pipelineResult.resume_json.skills_grouped.flatMap((g) => g.items);
  assert.ok(!finalSkills.includes('React'), 'Skill React fora da whitelist deve ser removida');
  // Garante que o Critic corrigiu a métrica inventada (75%)
  assert.ok(
    !pipelineResult.resume_json.projects[0].bullets[0].text.includes('75%'),
    'Auditor semântico deve corrigir métrica inventada'
  );
  assert.strictEqual(pipelineResult.audit_report.corrections.length, 1);
  assert.ok(pipelineResult.match_report.excluded_gaps.includes('React'));
  console.log('  ✓ Pipeline 3 Camadas (Modo Isolado + Critic Anti-Alucinação)');

  // 5B. Modo Econômico (padrão): 2 chamadas quando limpo (pula Critic) + telemetria de tokens + evidence_idx + compactJobDescription
  {
    const longBoilerplateJd =
      'Sobre a Empresa\n' + 'Texto institucional longo. '.repeat(120) +
      '\nRequisitos\n- Python e SQL\n- APIs REST e PostgreSQL\n' +
      '\nBenefícios\n' + 'Vale refeição, gympass e plano de saúde. '.repeat(80);
    const compacted = compactJobDescription(longBoilerplateJd, 2800);
    assert.ok(compacted.length <= 2800, 'JD compactada deve respeitar teto de 2800 chars');
    assert.ok(compacted.includes('Python e SQL'), 'JD compactada deve preservar requisitos');
    assert.ok(!compacted.includes('gympass'), 'JD compactada deve remover boilerplate de benefícios');

    assert.deepStrictEqual(detectUnverifiedMetrics('Reduziu custos em 75% e 3x', 'Coleta vagas em 5 portais'), ['75%', '3x']);
    assert.deepStrictEqual(detectUnverifiedMetrics('Coleta vagas em 5 portais desde 2025', 'Coleta vagas em 5 portais'), []);

    const economicClean = await generateTruthfulATSResume({
      profile: SAMPLE_PROFILE,
      job: { empresa: 'Acme', cargo: 'Estágio Backend Python', requisitos: 'Python, SQL e APIs REST' },
      llmConfig: { provider: 'gemini', apiKey: 'mock-key' },
      llmCaller: async ({ userPrompt, onUsage }) => {
        if (onUsage) onUsage({ input_tokens: 450, output_tokens: 220, total_tokens: 670 });
        if (userPrompt.includes('VAGA ALVO:')) {
          return {
            target_role: 'Estágio Backend Python',
            ats_keywords: ['Python', 'SQL', 'REST'],
            direct_matches: ['Python', 'SQL'],
            terminological_matches: [],
            excluded_gaps: ['Go'],
            fit_summary: 'Boa aderência em Python e SQL.'
          };
        }
        if (userPrompt.includes('GERAÇÃO CONSOLIDADA ATS')) {
          return {
            summary: 'Estudante de Engenharia de Software com foco em Python e SQL.',
            skills_grouped: [{ category: 'Linguagens', items: ['Python', 'SQL', 'Go'] }],
            projects: [
              {
                project_id: 'proj-sona',
                tech_stack: ['Python', 'PostgreSQL', 'Go'],
                bullets: [{ text: 'Desenvolveu pipeline em Python coletando vagas em 5 portais.', evidence_idx: 0 }]
              },
              {
                project_id: 'proj-api',
                tech_stack: ['Node.js', 'SQL'],
                bullets: [{ text: 'Construiu endpoints REST em Node.js com consultas SQL.', evidence_idx: 0 }]
              }
            ],
            experiences: []
          };
        }
        throw new Error('Critic não deveria ser chamado quando não há bullets suspeitos');
      }
    });

    assert.strictEqual(economicClean.audit_report.token_usage.mode, 'economic');
    assert.strictEqual(economicClean.audit_report.token_usage.llm_calls, 2, 'Modo econômico limpo deve usar apenas 2 chamadas IA');
    assert.strictEqual(economicClean.audit_report.token_usage.total_tokens, 1340, 'Deve acumular telemetria real de tokens');
    assert.strictEqual(economicClean.audit_report.critic_skipped_clean, true, 'Deve pular Critic quando nenhum bullet é suspeito');
    assert.strictEqual(
      economicClean.resume_json.projects[0].bullets[0].evidence_quote,
      'Coleta vagas em 5 portais usando Python e httpx.',
      'evidence_idx deve ser resolvido verbatim para o fato original'
    );
    assert.ok(!economicClean.resume_json.skills_grouped.flatMap((g) => g.items).includes('Go'), 'Whitelist continua bloqueando Go');
    console.log('  ✓ Modo Econômico padrão (2 chamadas IA, Critic condicional, evidence_idx e telemetria de tokens)');
  }

  // 6. Parser determinístico de CSVs do LinkedIn ZIP
  const parsedLi = parseLinkedInFiles({
    'Profile.csv': 'First Name,Last Name,Headline,Geo Location\n"João","Francisco","Engenharia de Software, PUC Minas","Belo Horizonte, MG"',
    'Education.csv': 'School Name,Degree Name,Field Of Study,Start Date,End Date\n"PUC Minas","Bacharelado","Engenharia de Software","2025","2028"',
    'Skills.csv': 'Name\nPython\nSQL\n"Git"',
    'Positions.csv': 'Company Name,Title,Description,Started On,Finished On\n"Empresa Jr","Desenvolvedor","Criou APIs em Node.js\nOrganizou banco PostgreSQL","Jan 2025",""'
  });
  assert.strictEqual(parsedLi.basics.name, 'João Francisco');
  assert.strictEqual(parsedLi.education[0].institution, 'PUC Minas');
  assert.deepStrictEqual(parsedLi.skills_whitelist, ['Python', 'SQL', 'Git']);
  assert.strictEqual(parsedLi.experiences[0].facts.length, 2);
  console.log('  ✓ Parser determinístico de CSVs do LinkedIn (.zip)');
}

module.exports = { runResumeEngineTests };
