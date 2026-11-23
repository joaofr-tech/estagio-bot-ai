/**
 * Sona Resume Studio — Motor Anti-Alucinação & Otimização ATS em 3 Camadas
 *
 * Camada 1: Análise da Vaga (JD Parser) + Seleção Determinística Top 2–3 Projetos + Matriz de Match/Gaps
 * Camada 2: Geração Isolada por project_id / experience_id (impossível misturar projetos) + Cópia Determinística de Formação/Datas
 * Camada 3: Guardrails Determinísticos (Whitelist de Skills, Forbidden Gaps, Cross-Project Check, Integridade de Formação) + Auditor Semântico (Critic)
 */

const { callLLMJson } = require('./llm');

function normalizeToken(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+#.\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PROMPT_INJECTION_PATTERNS = [
  { id: 'ignore_instructions', regex: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)\b/gi },
  { id: 'ignore_instructions_pt', regex: /\b(ignore|desconsidere|esque[cç]a)\s+(todas?\s+as\s+)?(instru[cç][oõ]es|regras|comandos)\s+(anteriores|acima)\b/gi },
  { id: 'role_override', regex: /\b(you are now|act as a|system prompt:|assistant:|\[system\]|<\|im_start\|>)\b/gi },
  { id: 'hidden_directive', regex: /\b(if you are an? (ai|llm|agent)|note to (ai|llm|chatgpt|claude)|include the word)\b/gi }
];

const DEFAULT_BANNED_PHRASES = [
  // PT-BR clichês de IA
  'apaixonado por tecnologia',
  'apaixonada por tecnologia',
  'alavancar',
  'sinergia',
  'proativo e dinâmico',
  'proativa e dinâmica',
  'pensar fora da caixa',
  'vestir a camisa',
  'soluções inovadoras de ponta',
  // EN clichês de IA
  'passionate about technology',
  'results-driven',
  'cutting-edge',
  'fast-paced environment',
  'leverage synergies',
  'synergy',
  'delve into',
  'hardworking team player',
  'think outside the box'
];

const DEFAULT_BANNED_CHARS = ['—', '\u200B', '\u200C', '\u200D', '\uFEFF'];

/**
 * Sanitiza a descrição de vaga (JD) contra instruções ocultas de prompt injection
 * e caracteres invisíveis (inspirado em job-hunt-agent/docs/portals.md).
 */
function sanitizeJobDescription(jdText = '') {
  const raw = String(jdText || '');
  const warnings = [];

  // Remove caracteres zero-width invisíveis frequentemente usados para ocultar texto
  let sanitized = raw.replace(/[\u200B-\u200D\uFEFF]/g, '');
  if (sanitized.length !== raw.length) {
    warnings.push({
      kind: 'zero_width_chars',
      detail: 'Caracteres invisíveis (zero-width) removidos da descrição da vaga.'
    });
  }

  for (const { id, regex } of PROMPT_INJECTION_PATTERNS) {
    regex.lastIndex = 0;
    const matches = sanitized.match(regex);
    if (matches && matches.length > 0) {
      warnings.push({
        kind: id,
        matches: matches.slice(0, 3),
        detail: `Possível instrução de prompt injection neutralizada (${id}).`
      });
      sanitized = sanitized.replace(regex, '[trecho-ignorado]');
    }
  }

  return { sanitizedText: sanitized.trim(), warnings };
}

/**
 * Linter determinístico anti-clichê de IA para textos de currículo e outreach
 * (portado de job-hunt-agent/src/jobhunt/lint.py).
 */
function lintResumeText(
  text = '',
  {
    bannedChars = DEFAULT_BANNED_CHARS,
    bannedPhrases = DEFAULT_BANNED_PHRASES,
    maxChars = null
  } = {}
) {
  const value = String(text || '');
  const issues = [];

  for (const ch of bannedChars || []) {
    if (value.includes(ch)) {
      const code = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
      issues.push({
        kind: 'char',
        token: ch,
        message: `Caractere proibido ${JSON.stringify(ch)} (U+${code})`
      });
    }
  }

  for (const phrase of bannedPhrases || []) {
    const rx = new RegExp(`(?<!\\w)${escapeRegExp(phrase)}(?!\\w)`, 'i');
    const m = value.match(rx);
    if (m) {
      issues.push({
        kind: 'phrase',
        token: m[0],
        message: `Clichê de IA detectado: "${m[0]}"`
      });
    }
  }

  if (typeof maxChars === 'number' && maxChars > 0) {
    const trimmedLen = value.trim().length;
    if (trimmedLen > maxChars) {
      issues.push({
        kind: 'length',
        token: String(trimmedLen),
        message: `${trimmedLen} caracteres (limite recomendado: ${maxChars})`
      });
    }
  }

  return issues;
}

function cleanStyleChars(text = '') {
  return String(text || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s*—\s*/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Detecta automaticamente se a vaga está em Inglês ou Português (pt-BR).
 */
function detectJobLanguage(text) {
  const norm = normalizeToken(text);
  if (!norm) return 'pt-BR';
  const ptSignals = [
    'estagio', 'requisitos', 'vaga', 'graduacao', 'cursando', 'conhecimento',
    'desenvolvimento', 'experiencia', 'habilidades', 'diferencial', 'empresa',
    'trabalho', 'remoto', 'presencial', 'hibrido', 'bolsa', 'beneficios'
  ];
  const enSignals = [
    'internship', 'intern', 'requirements', 'responsibilities', 'qualifications',
    'experience', 'skills', 'software engineer', 'bachelor', 'pursuing',
    'degree', 'team', 'building', 'looking for', 'must have', 'nice to have'
  ];
  let ptScore = 0;
  let enScore = 0;
  for (const w of ptSignals) if (new RegExp(`\\b${escapeRegExp(w)}\\b`).test(norm)) ptScore++;
  for (const w of enSignals) if (new RegExp(`\\b${escapeRegExp(w)}\\b`).test(norm)) enScore++;
  return enScore > ptScore ? 'en' : 'pt-BR';
}

/**
 * Constrói a Whitelist Determinística de todas as tecnologias/skills verificadas do usuário.
 */
function buildSkillsWhitelist(profile = {}) {
  const raw = new Set();
  const add = (val) => {
    if (!val) return;
    if (Array.isArray(val)) {
      val.forEach(add);
    } else if (typeof val === 'string') {
      const clean = val.trim();
      if (clean) raw.add(clean);
    }
  };

  add(profile.skills_whitelist);
  (profile.projects || []).forEach((p) => {
    add(p.languages);
    add(p.verified_skills);
    add(p.topics);
  });
  (profile.experiences || []).forEach((e) => {
    add(e.verified_skills);
  });

  // Deduplica preservando capitalização original
  const byNorm = new Map();
  for (const item of raw) {
    const key = normalizeToken(item);
    if (key && !byNorm.has(key)) {
      byNorm.set(key, item);
    }
  }
  return Array.from(byNorm.values());
}

/**
 * Seleciona deterministicamente os Top 2–3 projetos mais aderentes à vaga.
 * Mesmo em baixo fit, garante a seleção dos projetos mais transferíveis.
 */
function selectTopProjectsDeterministically(projects = [], jdText = '', jdKeywords = [], maxCount = 3) {
  if (!Array.isArray(projects) || projects.length === 0) return [];
  const limit = Math.min(Math.max(1, maxCount), projects.length);

  const jdNorm = normalizeToken(jdText);
  const kwNorms = Array.from(
    new Set(
      (jdKeywords || [])
        .map(normalizeToken)
        .filter((k) => k.length >= 2)
    )
  );

  const scored = projects.map((proj, idx) => {
    const corpus = normalizeToken([
      proj.name,
      proj.readme_summary,
      ...(proj.languages || []),
      ...(proj.verified_skills || []),
      ...(proj.topics || []),
      ...(proj.facts || [])
    ].join(' '));

    let score = 0;
    const matchedKeywords = [];

    // 1. Match de palavras-chave extraídas da JD
    for (const kw of kwNorms) {
      if (corpus.includes(kw)) {
        score += 4;
        matchedKeywords.push(kw);
      }
    }

    // 2. Match de linguagens/skills do projeto diretamente no texto da JD
    const projTechs = [...(proj.languages || []), ...(proj.verified_skills || [])];
    for (const tech of projTechs) {
      const tn = normalizeToken(tech);
      if (tn.length >= 2 && new RegExp(`(^|\\s)${escapeRegExp(tn)}(\\s|$)`).test(jdNorm)) {
        score += 5;
        matchedKeywords.push(tech);
      }
    }

    // 3. Riqueza de fatos verificáveis (desempate em baixo fit)
    const factCount = (proj.facts || []).length + (proj.readme_summary ? 1 : 0);
    score += Math.min(3, factCount * 0.5);

    // 4. Preferência leve se o usuário marcou destaque/pinned
    if (proj.pinned) score += 2;

    return {
      project: proj,
      score,
      matchedKeywords: Array.from(new Set(matchedKeywords)),
      originalIndex: idx
    };
  });

  scored.sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);
  return scored.slice(0, limit);
}

/**
 * CAMADA 1: Analisa a vaga, seleciona os Top 2-3 projetos e constrói a Matriz de Match/Gaps.
 */
async function analyzeJobAndBuildMatchMatrix({ profile, job, jdText, llmConfig, llmCaller = callLLMJson }) {
  const whitelist = buildSkillsWhitelist(profile);
  const rawJd = [job?.cargo, job?.empresa, job?.requisitos, jdText].filter(Boolean).join('\n\n');
  const { sanitizedText: fullJd, warnings: promptInjectionWarnings } = sanitizeJobDescription(rawJd);
  const idioma = detectJobLanguage(fullJd);

  const systemPrompt = `Você é um especialista sênior em recrutamento técnico e sistemas ATS.
Sua tarefa é analisar a descrição de uma vaga e compará-la RIGOROSAMENTE com o Banco de Fatos real do candidato.
REGRA INVIOLÁVEL: NUNCA invente skills, tecnologias ou experiências que o candidato não possui.
Responda APENAS JSON válido seguindo exatamente o schema pedido.`;

  const userPrompt = `VAGA ALVO:
Cargo: ${job?.cargo || 'Não informado'}
Empresa: ${job?.empresa || 'Não informada'}
Descrição / Requisitos:
${fullJd}

SKILLS VERIFICADAS DO CANDIDATO (WHITELIST):
${JSON.stringify(whitelist)}

PROJETOS VERIFICADOS DO CANDIDATO:
${JSON.stringify((profile.projects || []).map((p) => ({
  id: p.id,
  name: p.name,
  languages: p.languages || [],
  verified_skills: p.verified_skills || [],
  summary: (p.readme_summary || '').slice(0, 400),
  facts: (p.facts || []).slice(0, 6)
})))}

EXPERIÊNCIAS VERIFICADAS DO CANDIDATO:
${JSON.stringify((profile.experiences || []).map((e) => ({
  id: e.id,
  company: e.company,
  role: e.role,
  facts: (e.facts || []).slice(0, 6)
})))}

Retorne JSON no formato exato:
{
  "target_role": "Título limpo do cargo alvo",
  "ats_keywords": ["lista de 8 a 15 palavras-chave ATS extraídas da vaga"],
  "direct_matches": ["skills/requisitos da vaga que o candidato REALMENTE possui na whitelist ou fatos"],
  "terminological_matches": [
    {
      "jd_term": "termo ou competência pedida na vaga",
      "candidate_evidence": "fato real do candidato que se conecta a isso",
      "safe_framing": "como enquadrar honestamente sem mentir nem inventar cargo/tecnologia"
    }
  ],
  "excluded_gaps": ["tecnologias/requisitos pedidos na vaga que o candidato NÃO possui e que estão PROIBIDOS no currículo"],
  "fit_summary": "Resumo honesto de 1-2 frases sobre a aderência do perfil à vaga"
}`;

  const analysis = await llmCaller({
    ...llmConfig,
    systemPrompt,
    userPrompt,
    temperature: 0.15
  });

  const atsKeywords = Array.isArray(analysis.ats_keywords) ? analysis.ats_keywords : [];
  const selectedScored = selectTopProjectsDeterministically(
    profile.projects || [],
    fullJd,
    [...atsKeywords, ...(analysis.direct_matches || [])],
    3
  );

  // Garante que nenhum termo da whitelist entre por engano em excluded_gaps
  const whitelistNormSet = new Set(whitelist.map(normalizeToken));
  const excludedGaps = (Array.isArray(analysis.excluded_gaps) ? analysis.excluded_gaps : []).filter(
    (gap) => !whitelistNormSet.has(normalizeToken(gap))
  );

  return {
    idioma,
    target_role: analysis.target_role || job?.cargo || 'Estágio em Tecnologia',
    ats_keywords: atsKeywords,
    direct_matches: Array.isArray(analysis.direct_matches) ? analysis.direct_matches : [],
    terminological_matches: Array.isArray(analysis.terminological_matches) ? analysis.terminological_matches : [],
    excluded_gaps: excludedGaps,
    fit_summary: analysis.fit_summary || '',
    selected_projects: selectedScored.map((s) => s.project),
    selected_project_ids: selectedScored.map((s) => s.project.id),
    whitelist,
    prompt_injection_warnings: promptInjectionWarnings
  };
}

/**
 * CAMADA 2: Geração Isolada por Projeto e por Experiência.
 * Cada projeto é reescrito em chamada isolada contendo APENAS os seus próprios fatos.
 */
async function generateIsolatedResume({ profile, matchMatrix, llmConfig, llmCaller = callLLMJson }) {
  const { idioma, target_role, direct_matches, terminological_matches, excluded_gaps, selected_projects, whitelist } = matchMatrix;
  const langLabel = idioma === 'en' ? 'English (US)' : 'Português do Brasil (PT-BR)';

  const projectPromises = selected_projects.map(async (project) => {
    const allowedProjectTechs = Array.from(
      new Set([...(project.languages || []), ...(project.verified_skills || [])])
    );

    const systemPrompt = `Você é um redator de currículos ATS rigorosamente factual.
Escreva em ${langLabel}.
REGRAS INVIOLÁVEIS:
1. Use EXCLUSIVAMENTE os fatos, linguagens e README deste único projeto.
2. PROIBIDO inventar métricas, números, percentuais ou tecnologias que não estejam nos fatos abaixo.
3. PROIBIDO usar qualquer termo da lista de GAPS PROIBIDOS.
4. Adapte a clareza e verbos de ação para o cargo alvo "${target_role}" usando apenas equivalências honestas.
5. Para cada bullet gerado, devolva "evidence_quote" citando o trecho real de origem.
Responda APENAS JSON válido.`;

    const userPrompt = `PROJETO ISOLADO (id: ${project.id}):
Nome: ${project.name}
URL: ${project.url || ''}
Linguagens/Tecnologias Verificadas DESTE projeto: ${JSON.stringify(allowedProjectTechs)}
Resumo/README: ${project.readme_summary || 'Sem README detalhado'}
Fatos verificados DESTE projeto: ${JSON.stringify(project.facts || [])}

PALAVRAS-CHAVE PERMITIDAS (use somente se fizerem sentido real para ESTE projeto):
${JSON.stringify(direct_matches)}

EQUIVALÊNCIAS TERMINOLÓGICAS PERMITIDAS:
${JSON.stringify(terminological_matches)}

GAPS PROIBIDOS (NUNCA MENCIONE):
${JSON.stringify(excluded_gaps)}

Retorne JSON exato:
{
  "project_id": "${project.id}",
  "name": "${project.name}",
  "tech_stack": ["subset das tecnologias verificadas DESTE projeto"],
  "bullets": [
    {
      "text": "Bullet conciso orientado a ação e resultado factual (máx 180 caracteres)",
      "evidence_quote": "trecho exato dos fatos/README que comprova este bullet"
    }
  ]
}
Gere entre 2 e 3 bullets no máximo.`;

    const generated = await llmCaller({
      ...llmConfig,
      systemPrompt,
      userPrompt,
      temperature: 0.2
    });

    return {
      id: project.id,
      name: project.name, // Nome imutável do Banco de Fatos
      url: project.url || '',
      tech_stack: Array.isArray(generated.tech_stack) && generated.tech_stack.length > 0
        ? generated.tech_stack
        : allowedProjectTechs,
      bullets: Array.isArray(generated.bullets) ? generated.bullets.slice(0, 3) : []
    };
  });

  const experiencesList = (profile.experiences || []).slice(0, 3);
  const experiencePromises = experiencesList.map(async (exp) => {
    const systemPrompt = `Você é um redator de currículos ATS rigorosamente factual.
Escreva em ${langLabel}.
Use EXCLUSIVAMENTE os fatos desta experiência. PROIBIDO inventar métricas, cargos, empresas ou tecnologias.
Responda APENAS JSON válido.`;

    const userPrompt = `EXPERIÊNCIA ISOLADA (id: ${exp.id}):
Empresa: ${exp.company}
Cargo: ${exp.role}
Período: ${exp.start_date || ''} - ${exp.end_date || 'Atual'}
Fatos verificados: ${JSON.stringify(exp.facts || [])}
Tecnologias verificadas: ${JSON.stringify(exp.verified_skills || [])}
GAPS PROIBIDOS: ${JSON.stringify(excluded_gaps)}

Retorne JSON exato:
{
  "experience_id": "${exp.id}",
  "bullets": [
    {
      "text": "Bullet factual conciso (máx 180 caracteres)",
      "evidence_quote": "fato original correspondente"
    }
  ]
}
Gere entre 2 e 3 bullets (ou 1 se houver poucos fatos).`;

    const generated = await llmCaller({
      ...llmConfig,
      systemPrompt,
      userPrompt,
      temperature: 0.2
    });

    return {
      id: exp.id,
      company: exp.company, // Imutável
      role: exp.role,       // Imutável
      location: exp.location || '',
      start_date: exp.start_date || '',
      end_date: exp.end_date || '',
      bullets: Array.isArray(generated.bullets) ? generated.bullets.slice(0, 3) : []
    };
  });

  // Resumo Profissional + Organização de Skills (somente da whitelist!)
  const summaryPromise = llmCaller({
    ...llmConfig,
    systemPrompt: `Você é um redator de currículos ATS rigorosamente factual.
Escreva em ${langLabel}.
Crie um resumo profissional curto (2 a 3 linhas) e organize as skills do candidato priorizando as que dão match com a vaga.
REGRA INVIOLÁVEL: Só inclua skills que existam LITERALMENTE na WHITELIST fornecida. NUNCA inclua termos dos GAPS PROIBIDOS.
Responda APENAS JSON válido.`,
    userPrompt: `CARGO ALVO: ${target_role}
FORMAÇÃO REAL: ${JSON.stringify(profile.education || [])}
HEADLINE/RESUMO BASE: ${profile.basics?.headline || ''} ${profile.basics?.summary || ''}
SKILLS WHITELIST (ÚNICAS SKILLS PERMITIDAS): ${JSON.stringify(whitelist)}
MATCHES DIRETOS: ${JSON.stringify(direct_matches)}
EQUIVALÊNCIAS TERMINOLÓGICAS: ${JSON.stringify(terminological_matches)}
GAPS PROIBIDOS: ${JSON.stringify(excluded_gaps)}

Retorne JSON exato:
{
  "summary": "Resumo factual de 2-3 frases alinhado à vaga sem mentir",
  "skills_grouped": [
    { "category": "Nome da categoria (ex: Linguagens, Frameworks & Web, Dados & Cloud, Ferramentas)", "items": ["somente itens da WHITELIST"] }
  ]
}`,
    temperature: 0.2
  });

  const [projectsOut, experiencesOut, summaryOut] = await Promise.all([
    Promise.all(projectPromises),
    Promise.all(experiencePromises),
    summaryPromise
  ]);

  // Cópia DETERMINÍSTICA de dados imutáveis (basics, education, certifications, languages_spoken)
  return {
    idioma,
    target_role,
    basics: {
      name: profile.basics?.name || 'Candidato',
      email: profile.basics?.email || '',
      phone: profile.basics?.phone || '',
      location: profile.basics?.location || '',
      linkedin: profile.basics?.linkedin || '',
      github: profile.basics?.github || (profile.github_username ? `https://github.com/${profile.github_username}` : ''),
      portfolio: profile.basics?.portfolio || ''
    },
    summary: summaryOut?.summary || '',
    education: (profile.education || []).map((edu) => ({
      id: edu.id,
      institution: edu.institution,
      degree: edu.degree,
      field: edu.field || '',
      start_date: edu.start_date || '',
      end_date: edu.end_date || '',
      highlights: Array.isArray(edu.highlights) ? edu.highlights : []
    })),
    experiences: experiencesOut,
    projects: projectsOut,
    skills_grouped: Array.isArray(summaryOut?.skills_grouped) ? summaryOut.skills_grouped : [],
    certifications: (profile.certifications || []).slice(0, 5),
    languages_spoken: profile.languages_spoken || []
  };
}

/**
 * CAMADA 3A: Guardrails Determinísticos em Código (Hard Checks — zero confiança cega no LLM).
 */
function enforceDeterministicGuardrails({ resume, profile, matchMatrix }) {
  const whitelist = matchMatrix.whitelist || buildSkillsWhitelist(profile);
  const whitelistNorm = new Set(whitelist.map(normalizeToken));
  const forbiddenGaps = (matchMatrix.excluded_gaps || []).filter((g) => g && g.trim().length >= 2);

  const blockedSkills = [];
  const gapViolations = [];
  const crossProjectWarnings = [];
  const styleIssues = [];
  let educationRestored = false;

  // 1. Filtra skills_grouped estritamente pela whitelist
  const cleanSkillsGrouped = (resume.skills_grouped || [])
    .map((group) => {
      const kept = [];
      for (const item of group.items || []) {
        const norm = normalizeToken(item);
        if (whitelistNorm.has(norm)) {
          kept.push(item);
        } else {
          blockedSkills.push(item);
        }
      }
      return { category: group.category || 'Habilidades', items: kept };
    })
    .filter((g) => g.items.length > 0);

  // Fallback seguro: se o LLM retornou skills vazias mas o usuário tem whitelist, inclui whitelist
  if (cleanSkillsGrouped.length === 0 && whitelist.length > 0) {
    cleanSkillsGrouped.push({
      category: resume.idioma === 'en' ? 'Technical Skills' : 'Habilidades Técnicas',
      items: whitelist.slice(0, 15)
    });
  }

  // 2. Filtra tech_stack de cada projeto contra a stack real daquele projeto específico
  const sourceProjectsById = new Map((profile.projects || []).map((p) => [p.id, p]));
  const allOtherProjectNames = (profile.projects || []).map((p) => ({ id: p.id, nameNorm: normalizeToken(p.name) }));

  const cleanProjects = (resume.projects || []).map((proj) => {
    const src = sourceProjectsById.get(proj.id);
    const allowedForThisProject = new Set(
      [
        ...(src?.languages || []),
        ...(src?.verified_skills || []),
        ...(src?.topics || [])
      ].map(normalizeToken)
    );

    // Filtra tech_stack do projeto para conter apenas tecnologias reais daquele projeto
    const filteredStack = (proj.tech_stack || []).filter((t) => {
      const tn = normalizeToken(t);
      if (allowedForThisProject.size === 0) return whitelistNorm.has(tn);
      if (allowedForThisProject.has(tn)) return true;
      // Também permite se estiver explicitamente citado no README/fatos daquele projeto
      const srcText = normalizeToken([src?.readme_summary, ...(src?.facts || [])].join(' '));
      if (tn.length >= 2 && new RegExp(`(^|\\s)${escapeRegExp(tn)}(\\s|$)`).test(srcText)) {
        return true;
      }
      blockedSkills.push(`${t} (em ${proj.name})`);
      return false;
    });

    // Checa contaminação cruzada entre projetos (menção a outro projeto nos bullets) e estilo anti-clichê
    const checkedBullets = (proj.bullets || []).map((b) => {
      const origText = b?.text || '';
      const rawStyle = lintResumeText(origText, { maxChars: 220 });
      if (rawStyle.length > 0) {
        rawStyle.forEach((iss) => styleIssues.push({ location: `Projeto: ${proj.name}`, ...iss, text: origText }));
      }
      const cleanedText = cleanStyleChars(origText);
      const bNorm = normalizeToken(cleanedText);
      for (const other of allOtherProjectNames) {
        if (other.id !== proj.id && other.nameNorm.length >= 4 && bNorm.includes(other.nameNorm)) {
          crossProjectWarnings.push({
            project_id: proj.id,
            bullet: cleanedText,
            reason: `Possível referência cruzada ao projeto "${other.nameNorm}".`
          });
        }
      }
      // Checa termos proibidos (gaps)
      for (const gap of forbiddenGaps) {
        const gapNorm = normalizeToken(gap);
        if (gapNorm.length >= 2 && new RegExp(`(^|\\s)${escapeRegExp(gapNorm)}(\\s|$)`).test(bNorm)) {
          gapViolations.push({ location: `Projeto: ${proj.name}`, term: gap, text: cleanedText });
        }
      }
      return { ...b, text: cleanedText };
    });

    return {
      ...proj,
      tech_stack: filteredStack,
      bullets: checkedBullets
    };
  });

  // 3. Checa termos proibidos (gaps) e estilo anti-clichê no resumo e nas experiências
  const rawSummary = resume.summary || '';
  lintResumeText(rawSummary, { maxChars: 460 }).forEach((iss) => {
    styleIssues.push({ location: 'Resumo', ...iss, text: rawSummary });
  });
  const cleanSummary = cleanStyleChars(rawSummary);
  const summaryNorm = normalizeToken(cleanSummary);
  for (const gap of forbiddenGaps) {
    const gapNorm = normalizeToken(gap);
    if (gapNorm.length >= 2 && new RegExp(`(^|\\s)${escapeRegExp(gapNorm)}(\\s|$)`).test(summaryNorm)) {
      gapViolations.push({ location: 'Resumo', term: gap, text: cleanSummary });
    }
  }
  const cleanExperiences = (resume.experiences || []).map((exp) => ({
    ...exp,
    bullets: (exp.bullets || []).map((b) => {
      const origText = b?.text || '';
      lintResumeText(origText, { maxChars: 220 }).forEach((iss) => {
        styleIssues.push({ location: `Experiência: ${exp.company}`, ...iss, text: origText });
      });
      const cleanedText = cleanStyleChars(origText);
      const bNorm = normalizeToken(cleanedText);
      for (const gap of forbiddenGaps) {
        const gapNorm = normalizeToken(gap);
        if (gapNorm.length >= 2 && new RegExp(`(^|\\s)${escapeRegExp(gapNorm)}(\\s|$)`).test(bNorm)) {
          gapViolations.push({ location: `Experiência: ${exp.company}`, term: gap, text: cleanedText });
        }
      }
      return { ...b, text: cleanedText };
    })
  }));

  // 4. Integridade 1:1 da Formação Acadêmica (Education nunca pode ser inventada ou alterada)
  const expectedEdu = (profile.education || []).map((edu) => ({
    id: edu.id,
    institution: edu.institution,
    degree: edu.degree,
    field: edu.field || '',
    start_date: edu.start_date || '',
    end_date: edu.end_date || '',
    highlights: Array.isArray(edu.highlights) ? edu.highlights : []
  }));
  if (JSON.stringify(resume.education) !== JSON.stringify(expectedEdu)) {
    educationRestored = true;
  }

  return {
    resume: {
      ...resume,
      summary: cleanSummary,
      education: expectedEdu,
      experiences: cleanExperiences,
      projects: cleanProjects,
      skills_grouped: cleanSkillsGrouped
    },
    guardrails: {
      blocked_skills: Array.from(new Set(blockedSkills)),
      gap_violations: gapViolations,
      cross_project_warnings: crossProjectWarnings,
      style_issues: styleIssues,
      education_restored: educationRestored
    }
  };
}

/**
 * CAMADA 3B: Auditor Semântico (Critic Pass) — detecta métricas inventadas ou exageros e corrige.
 */
async function runSemanticCritic({ resume, guardrails, llmConfig, llmCaller = callLLMJson }) {
  const bulletsToAudit = [];
  (resume.projects || []).forEach((p) => {
    (p.bullets || []).forEach((b, idx) => {
      bulletsToAudit.push({
        ref: `project:${p.id}:${idx}`,
        section: `Projeto ${p.name}`,
        text: b.text,
        evidence_quote: b.evidence_quote || ''
      });
    });
  });
  (resume.experiences || []).forEach((e) => {
    (e.bullets || []).forEach((b, idx) => {
      bulletsToAudit.push({
        ref: `exp:${e.id}:${idx}`,
        section: `Experiência ${e.company}`,
        text: b.text,
        evidence_quote: b.evidence_quote || ''
      });
    });
  });

  if (bulletsToAudit.length === 0) {
    return {
      resume,
      audit_report: {
        status: 'passed',
        total_bullets_checked: 0,
        corrections: [],
        guardrails
      }
    };
  }

  const systemPrompt = `Você é um auditor rigoroso de veracidade de currículos (Anti-Hallucination Critic).
Compare cada bullet gerado com sua "evidence_quote".
Sinalize e reescreva APENAS bullets que:
1. Inventem números, porcentagens ou métricas que não aparecem na evidência.
2. Aleguem domínio de uma tecnologia ou responsabilidade que não existe na evidência.
Se o bullet for honesto e fiel (mesmo usando melhor vocabulário profissional), marque "verdict": "ok".
Responda APENAS JSON válido.`;

  const userPrompt = `BULLETS PARA AUDITORIA:
${JSON.stringify(bulletsToAudit)}

VIOLAÇÕES DE GAP DETECTADAS PELO CÓDIGO (se houver, reescreva removendo o termo proibido):
${JSON.stringify(guardrails.gap_violations || [])}

ALERTAS DE ESTILO / CLICHÊS DE IA DETECTADOS (se houver clichê em um bullet, reescreva de forma direta e factual):
${JSON.stringify((guardrails.style_issues || []).filter((s) => s.kind === 'phrase'))}

Retorne JSON exato:
{
  "results": [
    {
      "ref": "project:...:0",
      "verdict": "ok | corrected",
      "reason": "Motivo curto se corrigido, ou vazio se ok",
      "corrected_text": "Texto fiel corrigido (obrigatório apenas se verdict == corrected)"
    }
  ]
}`;

  let criticOut = { results: [] };
  try {
    criticOut = await llmCaller({
      ...llmConfig,
      systemPrompt,
      userPrompt,
      temperature: 0
    });
  } catch (err) {
    return {
      resume,
      audit_report: {
        status: 'guardrails_only',
        warning: `Auditor semântico indisponível (${err.message}); guardrails determinísticos aplicados com sucesso.`,
        total_bullets_checked: bulletsToAudit.length,
        corrections: [],
        guardrails
      }
    };
  }

  const corrections = [];
  const resultsByRef = new Map((criticOut.results || []).map((r) => [r.ref, r]));

  const auditedProjects = (resume.projects || []).map((p) => ({
    ...p,
    bullets: (p.bullets || []).map((b, idx) => {
      const ref = `project:${p.id}:${idx}`;
      const verdict = resultsByRef.get(ref);
      if (verdict && verdict.verdict === 'corrected' && verdict.corrected_text) {
        corrections.push({
          ref,
          original: b.text,
          corrected: verdict.corrected_text,
          reason: verdict.reason || 'Ajuste de fidelidade factual'
        });
        return { ...b, text: verdict.corrected_text, audited_corrected: true };
      }
      return b;
    })
  }));

  const auditedExperiences = (resume.experiences || []).map((e) => ({
    ...e,
    bullets: (e.bullets || []).map((b, idx) => {
      const ref = `exp:${e.id}:${idx}`;
      const verdict = resultsByRef.get(ref);
      if (verdict && verdict.verdict === 'corrected' && verdict.corrected_text) {
        corrections.push({
          ref,
          original: b.text,
          corrected: verdict.corrected_text,
          reason: verdict.reason || 'Ajuste de fidelidade factual'
        });
        return { ...b, text: verdict.corrected_text, audited_corrected: true };
      }
      return b;
    })
  }));

  return {
    resume: {
      ...resume,
      projects: auditedProjects,
      experiences: auditedExperiences
    },
    audit_report: {
      status: corrections.length === 0 && guardrails.blocked_skills.length === 0 && guardrails.gap_violations.length === 0
        ? 'verified_clean'
        : 'verified_with_guardrails',
      total_bullets_checked: bulletsToAudit.length,
      corrections,
      guardrails
    }
  };
}

/**
 * Orquestrador completo das 3 Camadas.
 */
async function generateTruthfulATSResume({ profile, job, jdText = '', llmConfig, llmCaller = callLLMJson, skipCritic = false }) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Banco de Fatos (Master Profile) não fornecido.');
  }

  // Camada 1
  const matchMatrix = await analyzeJobAndBuildMatchMatrix({
    profile,
    job,
    jdText,
    llmConfig,
    llmCaller
  });

  // Camada 2
  const rawResume = await generateIsolatedResume({
    profile,
    matchMatrix,
    llmConfig,
    llmCaller
  });

  // Camada 3A (Determinístico)
  const { resume: guardedResume, guardrails } = enforceDeterministicGuardrails({
    resume: rawResume,
    profile,
    matchMatrix
  });

  // Camada 3B (Auditor Semântico)
  const { resume: finalResume, audit_report } = skipCritic
    ? {
        resume: guardedResume,
        audit_report: {
          status: 'guardrails_only',
          total_bullets_checked: 0,
          corrections: [],
          guardrails
        }
      }
    : await runSemanticCritic({
        resume: guardedResume,
        guardrails,
        llmConfig,
        llmCaller
      });

  return {
    idioma: matchMatrix.idioma,
    resume_json: finalResume,
    match_report: {
      target_role: matchMatrix.target_role,
      ats_keywords: matchMatrix.ats_keywords,
      direct_matches: matchMatrix.direct_matches,
      terminological_matches: matchMatrix.terminological_matches,
      excluded_gaps: matchMatrix.excluded_gaps,
      fit_summary: matchMatrix.fit_summary,
      selected_project_ids: matchMatrix.selected_project_ids,
      prompt_injection_warnings: matchMatrix.prompt_injection_warnings || []
    },
    audit_report
  };
}

module.exports = {
  normalizeToken,
  detectJobLanguage,
  sanitizeJobDescription,
  lintResumeText,
  buildSkillsWhitelist,
  selectTopProjectsDeterministically,
  analyzeJobAndBuildMatchMatrix,
  generateIsolatedResume,
  enforceDeterministicGuardrails,
  runSemanticCritic,
  generateTruthfulATSResume
};
