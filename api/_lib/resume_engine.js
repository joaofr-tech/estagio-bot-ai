/**
 * Sona Resume Studio — Motor Anti-Alucinação & Otimização ATS em 3 Camadas (Econômico + Isolado)
 *
 * Camada 1: Compactação de JD + Pré-seleção Determinística de Projetos + Matriz de Match/Gaps (1 chamada)
 * Camada 2: Modo Econômico consolidado por ID com evidence_idx (1 chamada, padrão — ~70% menos tokens)
 *           OU Modo Isolado por entidade (isolated: true) + Cópia Determinística de Formação/Dados Básicos
 * Camada 3A: Guardrails Determinísticos (Whitelist, Forbidden Gaps, Cross-Project, Métricas Não Comprovadas, Linter Anti-Clichê, Formação Imutável)
 * Camada 3B: Auditor Semântico Condicional (só dispara nos bullets suspeitos; pula com 0 tokens quando limpo)
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

const JD_BOILERPLATE_HEADINGS = /^(sobre (a empresa|nos|nós)|quem somos|nossa cultura|benef[ií]cios|o que oferecemos|diversidade|inclus[aã]o|etapas do processo|lgpd|pol[ií]tica de privacidade|about us|who we are|our culture|benefits|perks|what we offer|equal opportunity|diversity|hiring process)\b/i;
const JD_HIGH_SIGNAL_HEADINGS = /^(requisitos|qualifica[cç][oõ]es|responsabilidades|atividades|desafios|diferenciais|conhecimentos|stack|tecnologias|o que voc[eê] vai fazer|requirements|qualifications|responsibilities|what you'?ll do|tech stack|skills|nice to have)\b/i;

/**
 * Sanitiza a descrição de vaga (JD) contra instruções ocultas de prompt injection
 * e caracteres invisíveis (inspirado em job-hunt-agent/docs/portals.md).
 */
function sanitizeJobDescription(jdText = '') {
  const raw = String(jdText || '');
  const warnings = [];

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
 * Compacta descrições de vaga muito longas removendo seções institucionais/benefícios
 * e priorizando requisitos, responsabilidades e stack (economiza ~40–60% dos tokens da Camada 1).
 */
function compactJobDescription(jdText = '', maxChars = 2800) {
  const clean = String(jdText || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= maxChars) return clean;

  const lines = clean.split('\n');
  const priority = [];
  const secondary = [];
  let mode = 'normal'; // 'high' | 'normal' | 'skip'

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const headingCandidate = line.replace(/^[#*\-\d.\s]+/, '').replace(/:$/, '').trim();
    if (headingCandidate.length <= 60) {
      if (JD_HIGH_SIGNAL_HEADINGS.test(headingCandidate)) {
        mode = 'high';
        priority.push(line);
        continue;
      }
      if (JD_BOILERPLATE_HEADINGS.test(headingCandidate)) {
        mode = 'skip';
        continue;
      }
    }
    if (mode === 'skip') continue;
    if (mode === 'high' || /^[-•*]/.test(line)) {
      priority.push(line);
    } else {
      secondary.push(line);
    }
  }

  const combined = [...priority, ...secondary].join('\n').trim();
  if (priority.length > 0 || combined.length >= 100) {
    return combined.slice(0, maxChars).trim();
  }
  return clean.slice(0, maxChars).trim();
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
 * Extrai métricas/números quantitativos (ex: 75%, 3x, 10k, 500ms, 120) de um texto
 * e sinaliza qualquer métrica ausente na evidência/fatos de origem.
 */
function extractMetricTokens(text = '') {
  const matches = String(text || '').match(/\b\d+(?:[.,]\d+)?(?:\s?(?:%|\+)|(?:\s?(?:x|k|m|ms|s|gb|mb|tb)\b)|\b)/gi) || [];
  return Array.from(
    new Set(
      matches
        .map((m) => m.toLowerCase().replace(/\s+/g, ''))
        // Ignora anos (1990–2039) e versões curtas tipo "0", "1"
        .filter((m) => !/^(?:19\d{2}|20[0-3]\d)$/.test(m) && m !== '0' && m !== '1')
    )
  );
}

function detectUnverifiedMetrics(bulletText = '', sourceCorpus = '') {
  const bulletNums = extractMetricTokens(bulletText);
  if (bulletNums.length === 0) return [];
  const sourceNorm = String(sourceCorpus || '').toLowerCase();
  const sourceNums = new Set(extractMetricTokens(sourceNorm));
  return bulletNums.filter((num) => {
    if (sourceNums.has(num)) return false;
    const bare = num.replace(/[^0-9.,]/g, '');
    if (bare && sourceNums.has(bare) && !num.includes('%') && !num.endsWith('x')) return false;
    return !sourceNorm.includes(num);
  });
}

function resolveBulletEvidence(bullet, sourceFacts = [], fallbackSummary = '') {
  const facts = Array.isArray(sourceFacts) ? sourceFacts : [];
  if (typeof bullet?.evidence_idx === 'number' && Number.isInteger(bullet.evidence_idx)) {
    if (bullet.evidence_idx >= 0 && bullet.evidence_idx < facts.length) {
      return String(facts[bullet.evidence_idx]);
    }
    if (bullet.evidence_idx === -1 && fallbackSummary) {
      return String(fallbackSummary).slice(0, 180);
    }
  }
  if (bullet?.evidence_quote) return String(bullet.evidence_quote);
  return facts[0] ? String(facts[0]) : String(fallbackSummary || '').slice(0, 160);
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

    for (const kw of kwNorms) {
      if (corpus.includes(kw)) {
        score += 4;
        matchedKeywords.push(kw);
      }
    }

    const projTechs = [...(proj.languages || []), ...(proj.verified_skills || [])];
    for (const tech of projTechs) {
      const tn = normalizeToken(tech);
      if (tn.length >= 2 && new RegExp(`(^|\\s)${escapeRegExp(tn)}(\\s|$)`).test(jdNorm)) {
        score += 5;
        matchedKeywords.push(tech);
      }
    }

    const factCount = (proj.facts || []).length + (proj.readme_summary ? 1 : 0);
    score += Math.min(3, factCount * 0.5);

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
 * CAMADA 1: Compacta JD, pré-filtra projetos candidatos e constrói a Matriz de Match/Gaps.
 */
async function analyzeJobAndBuildMatchMatrix({ profile, job, jdText, llmConfig, llmCaller = callLLMJson }) {
  const whitelist = buildSkillsWhitelist(profile);
  const rawJd = [job?.cargo, job?.empresa, job?.requisitos, jdText].filter(Boolean).join('\n\n');
  const { sanitizedText, warnings: promptInjectionWarnings } = sanitizeJobDescription(rawJd);
  const compactJd = compactJobDescription(sanitizedText, 2800);
  const idioma = detectJobLanguage(compactJd);

  // Pré-seleciona até 5 projetos mais aderentes antes de mandar ao LLM (evita inflar input com 15+ repos)
  const candidateProjects =
    (profile.projects || []).length > 5
      ? selectTopProjectsDeterministically(profile.projects, compactJd, whitelist, 5).map((s) => s.project)
      : (profile.projects || []);

  const systemPrompt =
    'Especialista ATS factual. Compare a vaga com os fatos reais do candidato. ' +
    'NUNCA invente skills/experiências. Responda APENAS JSON válido.';

  const userPrompt = `VAGA ALVO:
Cargo: ${job?.cargo || 'Não informado'} | Empresa: ${job?.empresa || 'Não informada'}
JD:
${compactJd}

WHITELIST: ${JSON.stringify(whitelist)}
PROJETOS: ${JSON.stringify(candidateProjects.map((p) => ({
    id: p.id,
    name: p.name,
    tech: Array.from(new Set([...(p.languages || []), ...(p.verified_skills || [])])),
    sum: (p.readme_summary || '').slice(0, 220),
    facts: (p.facts || []).slice(0, 4).map((f) => String(f).slice(0, 140))
  })))}
EXPERIÊNCIAS: ${JSON.stringify((profile.experiences || []).slice(0, 3).map((e) => ({
    id: e.id,
    company: e.company,
    role: e.role,
    facts: (e.facts || []).slice(0, 4).map((f) => String(f).slice(0, 140))
  })))}

JSON exato:
{"target_role":"","ats_keywords":["8-12 termos"],"direct_matches":["skills da whitelist"],"terminological_matches":[{"jd_term":"","candidate_evidence":"","safe_framing":""}],"excluded_gaps":["requisitos ausentes proibidos"],"fit_summary":"1-2 frases"}`;

  const analysis = await llmCaller({
    ...llmConfig,
    systemPrompt,
    userPrompt,
    temperature: 0.15,
    maxOutputTokens: 900
  });

  const atsKeywords = Array.isArray(analysis.ats_keywords) ? analysis.ats_keywords : [];
  const selectedScored = selectTopProjectsDeterministically(
    profile.projects || [],
    compactJd,
    [...atsKeywords, ...(analysis.direct_matches || [])],
    3
  );

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

function buildImmutableResumeShell(profile, matchMatrix, { summary = '', experiences = [], projects = [], skills_grouped = [] }) {
  return {
    idioma: matchMatrix.idioma,
    target_role: matchMatrix.target_role,
    basics: {
      name: profile.basics?.name || 'Candidato',
      email: profile.basics?.email || '',
      phone: profile.basics?.phone || '',
      location: profile.basics?.location || '',
      linkedin: profile.basics?.linkedin || '',
      github: profile.basics?.github || (profile.github_username ? `https://github.com/${profile.github_username}` : ''),
      portfolio: profile.basics?.portfolio || ''
    },
    summary,
    education: (profile.education || []).map((edu) => ({
      id: edu.id,
      institution: edu.institution,
      degree: edu.degree,
      field: edu.field || '',
      start_date: edu.start_date || '',
      end_date: edu.end_date || '',
      highlights: Array.isArray(edu.highlights) ? edu.highlights : []
    })),
    experiences,
    projects,
    skills_grouped,
    certifications: (profile.certifications || []).slice(0, 5),
    languages_spoken: profile.languages_spoken || []
  };
}

/**
 * CAMADA 2 (MODO ECONÔMICO — PADRÃO): Consolida resumo, skills, projetos e experiências
 * em 1 única chamada estruturada por ID usando evidence_idx (corta ~65–75% dos tokens).
 * O isolamento factual e contra contaminação cruzada continua garantido pela Camada 3A em código.
 */
async function generateConsolidatedResume({ profile, matchMatrix, llmConfig, llmCaller = callLLMJson }) {
  const { idioma, target_role, direct_matches, terminological_matches, excluded_gaps, selected_projects, whitelist } = matchMatrix;
  const langLabel = idioma === 'en' ? 'English (US)' : 'Português do Brasil (PT-BR)';
  const experiencesList = (profile.experiences || []).slice(0, 3);

  const projectInputs = selected_projects.map((p) => ({
    id: p.id,
    name: p.name,
    tech: Array.from(new Set([...(p.languages || []), ...(p.verified_skills || [])])),
    sum: (p.readme_summary || '').slice(0, 260),
    facts: (p.facts || []).slice(0, 6)
  }));

  const expInputs = experiencesList.map((e) => ({
    id: e.id,
    company: e.company,
    role: e.role,
    tech: e.verified_skills || [],
    facts: (e.facts || []).slice(0, 6)
  }));

  const compactTerms = (terminological_matches || []).slice(0, 5).map((t) => ({
    jd: t.jd_term,
    ok: t.safe_framing
  }));

  const systemPrompt =
    `Redator ATS rigorosamente factual em ${langLabel}. ` +
    'REGRAS: 1) Cada projeto/experiência usa EXCLUSIVAMENTE seus próprios facts/tech (proibido misturar entidades). ' +
    '2) PROIBIDO inventar números, métricas ou skills fora da WHITELIST. ' +
    '3) PROIBIDO usar termos de GAPS ou travessão (—). ' +
    '4) Em cada bullet, informe evidence_idx (índice do array facts daquela entidade, ou -1 se veio de sum). ' +
    'Responda APENAS JSON válido.';

  const userPrompt = `GERAÇÃO CONSOLIDADA ATS
CARGO ALVO: ${target_role}
FORMAÇÃO: ${JSON.stringify((profile.education || []).map((e) => `${e.degree} - ${e.institution}`))}
HEADLINE: ${profile.basics?.headline || ''} ${profile.basics?.summary || ''}
SKILLS WHITELIST: ${JSON.stringify(whitelist)}
MATCHES: ${JSON.stringify(direct_matches)}
EQUIVALÊNCIAS: ${JSON.stringify(compactTerms)}
GAPS PROIBIDOS: ${JSON.stringify(excluded_gaps)}
PROJETOS: ${JSON.stringify(projectInputs)}
EXPERIÊNCIAS: ${JSON.stringify(expInputs)}

Retorne JSON exato (2-3 bullets/entidade, máx 175 chars/bullet, sem clichês):
{"summary":"2-3 frases factuais","skills_grouped":[{"category":"","items":["apenas itens da WHITELIST"]}],"projects":[{"project_id":"","tech_stack":["subset do projeto"],"bullets":[{"text":"","evidence_idx":0}]}],"experiences":[{"experience_id":"","bullets":[{"text":"","evidence_idx":0}]}]}`;

  const out = await llmCaller({
    ...llmConfig,
    systemPrompt,
    userPrompt,
    temperature: 0.2,
    maxOutputTokens: 1600
  });

  const projById = new Map((Array.isArray(out?.projects) ? out.projects : []).map((p) => [p.project_id || p.id, p]));
  const expById = new Map((Array.isArray(out?.experiences) ? out.experiences : []).map((e) => [e.experience_id || e.id, e]));

  const projectsOut = selected_projects.map((src) => {
    const gen = projById.get(src.id) || {};
    const allowedTechs = Array.from(new Set([...(src.languages || []), ...(src.verified_skills || [])]));
    const rawBullets = Array.isArray(gen.bullets) ? gen.bullets.slice(0, 3) : [];
    const bullets = rawBullets.length > 0
      ? rawBullets.map((b) => ({
          text: String(b?.text || ''),
          evidence_quote: resolveBulletEvidence(b, src.facts, src.readme_summary)
        }))
      : (src.facts || []).slice(0, 2).map((f) => ({ text: String(f), evidence_quote: String(f) }));

    return {
      id: src.id,
      name: src.name,
      url: src.url || '',
      tech_stack: Array.isArray(gen.tech_stack) && gen.tech_stack.length > 0 ? gen.tech_stack : allowedTechs,
      bullets
    };
  });

  const experiencesOut = experiencesList.map((src) => {
    const gen = expById.get(src.id) || {};
    const rawBullets = Array.isArray(gen.bullets) ? gen.bullets.slice(0, 3) : [];
    const bullets = rawBullets.length > 0
      ? rawBullets.map((b) => ({
          text: String(b?.text || ''),
          evidence_quote: resolveBulletEvidence(b, src.facts, '')
        }))
      : (src.facts || []).slice(0, 2).map((f) => ({ text: String(f), evidence_quote: String(f) }));

    return {
      id: src.id,
      company: src.company,
      role: src.role,
      location: src.location || '',
      start_date: src.start_date || '',
      end_date: src.end_date || '',
      bullets
    };
  });

  return buildImmutableResumeShell(profile, matchMatrix, {
    summary: out?.summary || '',
    experiences: experiencesOut,
    projects: projectsOut,
    skills_grouped: Array.isArray(out?.skills_grouped) ? out.skills_grouped : []
  });
}

/**
 * CAMADA 2 (MODO ISOLADO — OPCIONAL via `isolated: true`):
 * Cada projeto e experiência é reescrito em chamada fisicamente isolada.
 */
async function generateIsolatedResume({ profile, matchMatrix, llmConfig, llmCaller = callLLMJson }) {
  const { idioma, target_role, direct_matches, terminological_matches, excluded_gaps, selected_projects, whitelist } = matchMatrix;
  const langLabel = idioma === 'en' ? 'English (US)' : 'Português do Brasil (PT-BR)';
  const compactTerms = (terminological_matches || []).slice(0, 5).map((t) => ({ jd: t.jd_term, ok: t.safe_framing }));

  const projectPromises = selected_projects.map(async (project) => {
    const allowedProjectTechs = Array.from(
      new Set([...(project.languages || []), ...(project.verified_skills || [])])
    );

    const systemPrompt =
      `Redator ATS factual em ${langLabel}. Use APENAS os fatos/tech deste projeto. ` +
      'PROIBIDO inventar métricas, usar GAPS ou travessão (—). Responda APENAS JSON válido.';

    const userPrompt = `PROJETO ISOLADO (id: ${project.id}):
Nome: ${project.name} | Tech: ${JSON.stringify(allowedProjectTechs)}
Resumo: ${(project.readme_summary || '').slice(0, 260)}
Fatos: ${JSON.stringify((project.facts || []).slice(0, 6))}
MATCHES: ${JSON.stringify(direct_matches)} | EQUIV: ${JSON.stringify(compactTerms)} | GAPS: ${JSON.stringify(excluded_gaps)}
JSON exato (2-3 bullets, máx 175 chars, informe evidence_idx do array Fatos ou -1):
{"project_id":"${project.id}","name":"${project.name}","tech_stack":[],"bullets":[{"text":"","evidence_idx":0}]}`;

    const generated = await llmCaller({
      ...llmConfig,
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      maxOutputTokens: 500
    });

    return {
      id: project.id,
      name: project.name,
      url: project.url || '',
      tech_stack: Array.isArray(generated.tech_stack) && generated.tech_stack.length > 0
        ? generated.tech_stack
        : allowedProjectTechs,
      bullets: Array.isArray(generated.bullets)
        ? generated.bullets.slice(0, 3).map((b) => ({
            text: String(b?.text || ''),
            evidence_quote: resolveBulletEvidence(b, project.facts, project.readme_summary)
          }))
        : []
    };
  });

  const experiencesList = (profile.experiences || []).slice(0, 3);
  const experiencePromises = experiencesList.map(async (exp) => {
    const systemPrompt =
      `Redator ATS factual em ${langLabel}. Use APENAS os fatos desta experiência. ` +
      'PROIBIDO inventar métricas, cargos ou tecnologias. Responda APENAS JSON válido.';

    const userPrompt = `EXPERIÊNCIA ISOLADA (id: ${exp.id}):
Empresa: ${exp.company} | Cargo: ${exp.role} | Tech: ${JSON.stringify(exp.verified_skills || [])}
Fatos: ${JSON.stringify((exp.facts || []).slice(0, 6))} | GAPS: ${JSON.stringify(excluded_gaps)}
JSON exato (1-3 bullets, máx 175 chars):
{"experience_id":"${exp.id}","bullets":[{"text":"","evidence_idx":0}]}`;

    const generated = await llmCaller({
      ...llmConfig,
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      maxOutputTokens: 450
    });

    return {
      id: exp.id,
      company: exp.company,
      role: exp.role,
      location: exp.location || '',
      start_date: exp.start_date || '',
      end_date: exp.end_date || '',
      bullets: Array.isArray(generated.bullets)
        ? generated.bullets.slice(0, 3).map((b) => ({
            text: String(b?.text || ''),
            evidence_quote: resolveBulletEvidence(b, exp.facts, '')
          }))
        : []
    };
  });

  const summaryPromise = llmCaller({
    ...llmConfig,
    systemPrompt:
      `Redator ATS factual em ${langLabel}. Crie resumo curto (2-3 linhas) e agrupe skills SOMENTE da WHITELIST. Responda APENAS JSON válido.`,
    userPrompt: `CARGO ALVO: ${target_role}
FORMAÇÃO: ${JSON.stringify((profile.education || []).map((e) => `${e.degree} - ${e.institution}`))}
HEADLINE: ${profile.basics?.headline || ''} ${profile.basics?.summary || ''}
SKILLS WHITELIST: ${JSON.stringify(whitelist)}
MATCHES: ${JSON.stringify(direct_matches)} | GAPS: ${JSON.stringify(excluded_gaps)}
JSON exato: {"summary":"","skills_grouped":[{"category":"","items":["apenas itens da WHITELIST"]}]}`,
    temperature: 0.2,
    maxOutputTokens: 500
  });

  const [projectsOut, experiencesOut, summaryOut] = await Promise.all([
    Promise.all(projectPromises),
    Promise.all(experiencePromises),
    summaryPromise
  ]);

  return buildImmutableResumeShell(profile, matchMatrix, {
    summary: summaryOut?.summary || '',
    experiences: experiencesOut,
    projects: projectsOut,
    skills_grouped: Array.isArray(summaryOut?.skills_grouped) ? summaryOut.skills_grouped : []
  });
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
  const unverifiedMetrics = [];
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

  if (cleanSkillsGrouped.length === 0 && whitelist.length > 0) {
    cleanSkillsGrouped.push({
      category: resume.idioma === 'en' ? 'Technical Skills' : 'Habilidades Técnicas',
      items: whitelist.slice(0, 15)
    });
  }

  // 2. Filtra tech_stack, contaminação cruzada, gaps, estilo e métricas não comprovadas por projeto
  const sourceProjectsById = new Map((profile.projects || []).map((p) => [p.id, p]));
  const sourceExpsById = new Map((profile.experiences || []).map((e) => [e.id, e]));
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
    const srcCorpus = [src?.readme_summary || '', ...(src?.facts || [])].join(' ');

    const filteredStack = (proj.tech_stack || []).filter((t) => {
      const tn = normalizeToken(t);
      if (allowedForThisProject.size === 0) return whitelistNorm.has(tn);
      if (allowedForThisProject.has(tn)) return true;
      const srcNorm = normalizeToken(srcCorpus);
      if (tn.length >= 2 && new RegExp(`(^|\\s)${escapeRegExp(tn)}(\\s|$)`).test(srcNorm)) {
        return true;
      }
      blockedSkills.push(`${t} (em ${proj.name})`);
      return false;
    });

    const checkedBullets = (proj.bullets || []).map((b, idx) => {
      const ref = `project:${proj.id}:${idx}`;
      const origText = b?.text || '';
      const rawStyle = lintResumeText(origText, { maxChars: 220 });
      if (rawStyle.length > 0) {
        rawStyle.forEach((iss) => styleIssues.push({ ref, location: `Projeto: ${proj.name}`, ...iss, text: origText }));
      }
      const cleanedText = cleanStyleChars(origText);
      const bNorm = normalizeToken(cleanedText);

      for (const other of allOtherProjectNames) {
        if (other.id !== proj.id && other.nameNorm.length >= 4 && bNorm.includes(other.nameNorm)) {
          crossProjectWarnings.push({
            ref,
            project_id: proj.id,
            bullet: cleanedText,
            reason: `Possível referência cruzada ao projeto "${other.nameNorm}".`
          });
        }
      }
      for (const gap of forbiddenGaps) {
        const gapNorm = normalizeToken(gap);
        if (gapNorm.length >= 2 && new RegExp(`(^|\\s)${escapeRegExp(gapNorm)}(\\s|$)`).test(bNorm)) {
          gapViolations.push({ ref, location: `Projeto: ${proj.name}`, term: gap, text: cleanedText });
        }
      }

      const badMetrics = detectUnverifiedMetrics(cleanedText, `${srcCorpus} ${b?.evidence_quote || ''}`);
      if (badMetrics.length > 0) {
        unverifiedMetrics.push({
          ref,
          location: `Projeto: ${proj.name}`,
          metrics: badMetrics,
          text: cleanedText
        });
      }

      return { ...b, text: cleanedText };
    });

    return {
      ...proj,
      tech_stack: filteredStack,
      bullets: checkedBullets
    };
  });

  // 3. Checa resumo e experiências
  const rawSummary = resume.summary || '';
  lintResumeText(rawSummary, { maxChars: 460 }).forEach((iss) => {
    styleIssues.push({ ref: 'summary', location: 'Resumo', ...iss, text: rawSummary });
  });
  const cleanSummary = cleanStyleChars(rawSummary);
  const summaryNorm = normalizeToken(cleanSummary);
  for (const gap of forbiddenGaps) {
    const gapNorm = normalizeToken(gap);
    if (gapNorm.length >= 2 && new RegExp(`(^|\\s)${escapeRegExp(gapNorm)}(\\s|$)`).test(summaryNorm)) {
      gapViolations.push({ ref: 'summary', location: 'Resumo', term: gap, text: cleanSummary });
    }
  }

  const cleanExperiences = (resume.experiences || []).map((exp) => {
    const src = sourceExpsById.get(exp.id);
    const srcCorpus = (src?.facts || []).join(' ');
    return {
      ...exp,
      bullets: (exp.bullets || []).map((b, idx) => {
        const ref = `exp:${exp.id}:${idx}`;
        const origText = b?.text || '';
        lintResumeText(origText, { maxChars: 220 }).forEach((iss) => {
          styleIssues.push({ ref, location: `Experiência: ${exp.company}`, ...iss, text: origText });
        });
        const cleanedText = cleanStyleChars(origText);
        const bNorm = normalizeToken(cleanedText);
        for (const gap of forbiddenGaps) {
          const gapNorm = normalizeToken(gap);
          if (gapNorm.length >= 2 && new RegExp(`(^|\\s)${escapeRegExp(gapNorm)}(\\s|$)`).test(bNorm)) {
            gapViolations.push({ ref, location: `Experiência: ${exp.company}`, term: gap, text: cleanedText });
          }
        }
        const badMetrics = detectUnverifiedMetrics(cleanedText, `${srcCorpus} ${b?.evidence_quote || ''}`);
        if (badMetrics.length > 0) {
          unverifiedMetrics.push({
            ref,
            location: `Experiência: ${exp.company}`,
            metrics: badMetrics,
            text: cleanedText
          });
        }
        return { ...b, text: cleanedText };
      })
    };
  });

  // 4. Integridade 1:1 da Formação Acadêmica
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
      unverified_metrics: unverifiedMetrics,
      education_restored: educationRestored
    }
  };
}

/**
 * CAMADA 3B: Auditor Semântico Condicional (Critic Pass).
 * Só envia ao LLM os bullets efetivamente sinalizados pela Camada 3A (métricas não comprovadas,
 * gaps, contaminação cruzada ou clichês). Se tudo passou limpo, pula com 0 tokens extras.
 */
async function runSemanticCritic({ resume, guardrails, llmConfig, llmCaller = callLLMJson, forceFullAudit = false }) {
  const allBullets = [];
  (resume.projects || []).forEach((p) => {
    (p.bullets || []).forEach((b, idx) => {
      allBullets.push({
        ref: `project:${p.id}:${idx}`,
        section: `Projeto ${p.name}`,
        text: b.text,
        evidence_quote: b.evidence_quote || ''
      });
    });
  });
  (resume.experiences || []).forEach((e) => {
    (e.bullets || []).forEach((b, idx) => {
      allBullets.push({
        ref: `exp:${e.id}:${idx}`,
        section: `Experiência ${e.company}`,
        text: b.text,
        evidence_quote: b.evidence_quote || ''
      });
    });
  });

  if (allBullets.length === 0) {
    return {
      resume,
      audit_report: {
        status: 'passed',
        total_bullets_checked: 0,
        critic_skipped_clean: true,
        corrections: [],
        guardrails
      }
    };
  }

  const flaggedRefs = new Set([
    ...(guardrails.unverified_metrics || []).map((x) => x.ref),
    ...(guardrails.gap_violations || []).map((x) => x.ref),
    ...(guardrails.cross_project_warnings || []).map((x) => x.ref),
    ...(guardrails.style_issues || []).filter((x) => x.kind === 'phrase').map((x) => x.ref)
  ]);

  const bulletsToAudit = forceFullAudit
    ? allBullets
    : allBullets.filter((b) => flaggedRefs.has(b.ref));

  // Economia de tokens: se nenhum bullet foi sinalizado pelos hard checks, não gasta chamada LLM extra
  if (bulletsToAudit.length === 0) {
    const clean =
      (guardrails.blocked_skills || []).length === 0 &&
      (guardrails.gap_violations || []).length === 0;
    return {
      resume,
      audit_report: {
        status: clean ? 'verified_clean' : 'verified_with_guardrails',
        total_bullets_checked: allBullets.length,
        critic_skipped_clean: true,
        corrections: [],
        guardrails
      }
    };
  }

  const systemPrompt =
    'Auditor anti-alucinação de currículos. Corrija APENAS bullets com métricas inventadas, gaps proibidos ou clichês. ' +
    'Retorne SOMENTE os itens corrigidos em JSON válido.';

  const userPrompt = `BULLETS PARA AUDITORIA:
${JSON.stringify(bulletsToAudit)}
MÉTRICAS SUSPEITAS: ${JSON.stringify(guardrails.unverified_metrics || [])}
GAPS: ${JSON.stringify(guardrails.gap_violations || [])}
CLICHÊS: ${JSON.stringify((guardrails.style_issues || []).filter((s) => s.kind === 'phrase'))}

JSON exato (inclua apenas itens corrigidos; se tudo ok, "results": []):
{"results":[{"ref":"project:...:0","verdict":"corrected","reason":"","corrected_text":""}]}`;

  let criticOut = { results: [] };
  try {
    criticOut = await llmCaller({
      ...llmConfig,
      systemPrompt,
      userPrompt,
      temperature: 0,
      maxOutputTokens: 600
    });
  } catch (err) {
    return {
      resume,
      audit_report: {
        status: 'guardrails_only',
        warning: `Auditor semântico indisponível (${err.message}); guardrails determinísticos aplicados com sucesso.`,
        total_bullets_checked: allBullets.length,
        critic_skipped_clean: false,
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
        const safeText = cleanStyleChars(verdict.corrected_text);
        corrections.push({
          ref,
          original: b.text,
          corrected: safeText,
          reason: verdict.reason || 'Ajuste de fidelidade factual'
        });
        return { ...b, text: safeText, audited_corrected: true };
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
        const safeText = cleanStyleChars(verdict.corrected_text);
        corrections.push({
          ref,
          original: b.text,
          corrected: safeText,
          reason: verdict.reason || 'Ajuste de fidelidade factual'
        });
        return { ...b, text: safeText, audited_corrected: true };
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
      total_bullets_checked: allBullets.length,
      critic_skipped_clean: false,
      corrections,
      guardrails
    }
  };
}

/**
 * Orquestrador completo das 3 Camadas.
 * Padrão: `isolated = false` (Modo Econômico: 2–3 chamadas LLM, ~70% menos tokens).
 * Opcional: `isolated = true` (1 chamada isolada por projeto/experiência).
 */
async function generateTruthfulATSResume({
  profile,
  job,
  jdText = '',
  llmConfig = {},
  llmCaller = callLLMJson,
  skipCritic = false,
  isolated = false
}) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Banco de Fatos (Master Profile) não fornecido.');
  }

  const tokenUsage = {
    mode: isolated ? 'isolated' : 'economic',
    llm_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0
  };

  const trackedCaller = async (params) => {
    tokenUsage.llm_calls += 1;
    const prevOnUsage = params?.onUsage;
    return llmCaller({
      ...params,
      onUsage: (u) => {
        if (u) {
          tokenUsage.input_tokens += Number(u.input_tokens || 0);
          tokenUsage.output_tokens += Number(u.output_tokens || 0);
          tokenUsage.total_tokens += Number(u.total_tokens || (Number(u.input_tokens || 0) + Number(u.output_tokens || 0)));
        }
        if (typeof prevOnUsage === 'function') prevOnUsage(u);
      }
    });
  };

  // Camada 1
  const matchMatrix = await analyzeJobAndBuildMatchMatrix({
    profile,
    job,
    jdText,
    llmConfig,
    llmCaller: trackedCaller
  });

  // Camada 2 (Econômico por padrão, Isolado por opção)
  const rawResume = isolated
    ? await generateIsolatedResume({
        profile,
        matchMatrix,
        llmConfig,
        llmCaller: trackedCaller
      })
    : await generateConsolidatedResume({
        profile,
        matchMatrix,
        llmConfig,
        llmCaller: trackedCaller
      });

  // Camada 3A (Determinístico)
  const { resume: guardedResume, guardrails } = enforceDeterministicGuardrails({
    resume: rawResume,
    profile,
    matchMatrix
  });

  // Camada 3B (Auditor Semântico Condicional)
  const { resume: finalResume, audit_report } = skipCritic
    ? {
        resume: guardedResume,
        audit_report: {
          status: 'guardrails_only',
          total_bullets_checked: 0,
          critic_skipped_clean: true,
          corrections: [],
          guardrails
        }
      }
    : await runSemanticCritic({
        resume: guardedResume,
        guardrails,
        llmConfig,
        llmCaller: trackedCaller
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
    audit_report: {
      ...audit_report,
      token_usage: tokenUsage
    }
  };
}

module.exports = {
  normalizeToken,
  detectJobLanguage,
  sanitizeJobDescription,
  compactJobDescription,
  lintResumeText,
  extractMetricTokens,
  detectUnverifiedMetrics,
  buildSkillsWhitelist,
  selectTopProjectsDeterministically,
  analyzeJobAndBuildMatchMatrix,
  generateConsolidatedResume,
  generateIsolatedResume,
  enforceDeterministicGuardrails,
  runSemanticCritic,
  generateTruthfulATSResume
};
