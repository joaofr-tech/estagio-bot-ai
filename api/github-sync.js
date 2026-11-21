/**
 * Vercel Serverless Function: POST /api/github-sync
 * Suporta 2 ações de baixa fricção:
 *  - action: "list" -> 1 chamada leve (até 100 repos), ranqueia projetos reais vs templates/auxiliares e pré-seleciona os melhores
 *  - action: "import" (ou padrão) -> lê languages + README.md apenas dos repositórios selecionados
 */

const NOISE_NAME_PATTERNS = [
  /^\.github$/i,
  /^dotfiles?$/i,
  /template/i,
  /boilerplate/i,
  /starter/i,
  /hello[-_ ]?world/i,
  /sandbox/i,
  /^test(e|es|s)?$/i,
  /^config(s)?$/i,
  /^exercicios?$/i,
  /^aulas?$/i,
  /^curso[-_ ]/i,
  /^estudos?$/i
];

function scoreAndClassifyRepo(repo, ownerLogin) {
  const name = String(repo.name || '');
  const lower = name.toLowerCase();
  const owner = String(ownerLogin || repo.owner?.login || '').toLowerCase();

  let noiseReason = '';
  if (repo.fork) noiseReason = 'Fork';
  else if (repo.archived) noiseReason = 'Arquivado';
  else if (repo.is_template) noiseReason = 'Template';
  else if (owner && lower === owner) noiseReason = 'Perfil README';
  else if (NOISE_NAME_PATTERNS.some((rx) => rx.test(name))) noiseReason = 'Template / Auxiliar';
  else if ((repo.size || 0) < 12 && !repo.description && !repo.language) noiseReason = 'Vazio / Muito pequeno';

  let score = 0;
  if (repo.description && repo.description.trim().length >= 12) score += 4;
  if (repo.homepage && /^https?:\/\//i.test(repo.homepage)) score += 3;
  if ((repo.stargazers_count || 0) > 0) score += Math.min(6, (repo.stargazers_count || 0) * 2);
  if (Array.isArray(repo.topics) && repo.topics.length > 0) score += 2;
  if (repo.language) score += 2;
  if ((repo.size || 0) >= 50) score += 2;
  if ((repo.size || 0) >= 300) score += 2;

  // Bônus leve por atividade recente (últimos 12 meses)
  if (repo.pushed_at) {
    const daysAgo = (Date.now() - new Date(repo.pushed_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysAgo <= 180) score += 2;
    else if (daysAgo <= 365) score += 1;
  }

  if (noiseReason) score -= 10;

  const recommended = !noiseReason && score >= 4;
  return {
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    url: repo.html_url,
    description: repo.description || '',
    language: repo.language || '',
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    stars: repo.stargazers_count || 0,
    size: repo.size || 0,
    is_private: !!repo.private,
    pushed_at: repo.pushed_at || repo.updated_at || '',
    score,
    recommended,
    noise_reason: noiseReason
  };
}

function extractFactsFromReadme(readmeText, description) {
  const facts = [];
  if (description && description.trim().length >= 8) {
    facts.push(description.trim());
  }
  if (!readmeText) return facts;

  const cleaned = readmeText
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  const lines = cleaned.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('|') || line.startsWith('---')) continue;
    const isBullet = /^[-*•]\s+/.test(line);
    const text = line.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (text.length >= 25 && text.length <= 260 && !/^http/i.test(text)) {
      if (isBullet || facts.length < 4) {
        facts.push(text);
      }
    }
    if (facts.length >= 8) break;
  }

  return Array.from(new Set(facts));
}

function buildReadmeSummary(readmeText, description) {
  const parts = [];
  if (description) parts.push(description.trim());
  if (readmeText) {
    const plain = readmeText
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (plain) parts.push(plain.slice(0, 700));
  }
  return parts.join(' — ').slice(0, 850);
}

async function ghFetch(url, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Sona-Resume-Studio/1.0'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg = errBody.message || `GitHub API HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-GitHub-Token');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido. Use POST.' });

  try {
    const body = req.body || {};
    const action = body.action || 'import';
    const token = req.headers['x-github-token'] || body.token || '';
    const username = (body.username || '').trim().replace(/^@/, '');
    const selectedFullNames = Array.isArray(body.selected_repos) ? body.selected_repos : null;

    if (!token && !username) {
      return res.status(400).json({
        error: 'Informe seu username público do GitHub ou conecte via GitHub OAuth.'
      });
    }

    // 1. Busca TODOS os repositórios (até 100 em 1 única chamada!)
    const reposUrl = token
      ? 'https://api.github.com/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator'
      : `https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=pushed&per_page=100&type=owner`;

    const rawRepos = await ghFetch(reposUrl, token);
    const repoList = Array.isArray(rawRepos) ? rawRepos : [];
    const resolvedUsername = username || repoList[0]?.owner?.login || '';

    // Ranqueia todos os repositórios (projetos reais no topo, templates/forks/vazios no fim)
    const classified = repoList
      .map((r) => scoreAndClassifyRepo(r, resolvedUsername))
      .sort((a, b) => b.score - a.score || (b.pushed_at || '').localeCompare(a.pushed_at || ''));

    // Se ação for apenas listar para o seletor visual: retorna instantaneamente (zero chamadas extras!)
    if (action === 'list') {
      return res.status(200).json({
        ok: true,
        username: resolvedUsername,
        total_found: classified.length,
        repos: classified
      });
    }

    // Caso contrário ("import"): filtra exatamente os repositórios escolhidos (ou os recomendados)
    let targetRawRepos;
    if (selectedFullNames && selectedFullNames.length > 0) {
      const selectedSet = new Set(selectedFullNames.map((n) => String(n).toLowerCase()));
      targetRawRepos = repoList.filter((r) => selectedSet.has(String(r.full_name || '').toLowerCase()));
    } else {
      const maxRepos = Math.min(20, Math.max(1, Number(body.maxRepos) || 10));
      const topIds = new Set(
        classified.filter((c) => !c.noise_reason).slice(0, maxRepos).map((c) => c.id)
      );
      targetRawRepos = repoList.filter((r) => topIds.has(r.id));
    }

    // 2. Para cada repo selecionado, busca linguagens + README.md em paralelo
    const projects = await Promise.all(
      targetRawRepos.map(async (repo) => {
        let languages = repo.language ? [repo.language] : [];
        let readmeText = '';

        try {
          const langObj = await ghFetch(repo.languages_url, token);
          const sortedLangs = Object.entries(langObj || {})
            .sort((a, b) => b[1] - a[1])
            .map(([lang]) => lang);
          if (sortedLangs.length > 0) languages = sortedLangs;
        } catch (_) {}

        try {
          const readmeData = await ghFetch(
            `https://api.github.com/repos/${repo.full_name}/readme`,
            token
          );
          if (readmeData && readmeData.content) {
            readmeText = Buffer.from(readmeData.content, 'base64').toString('utf8');
          }
        } catch (_) {}

        const topics = Array.isArray(repo.topics) ? repo.topics : [];
        const verifiedSkills = Array.from(new Set([...languages, ...topics]));

        return {
          id: `gh-${repo.id}`,
          name: repo.name,
          repo_full_name: repo.full_name,
          url: repo.html_url,
          description: repo.description || '',
          languages,
          topics,
          verified_skills: verifiedSkills,
          stars: repo.stargazers_count || 0,
          updated_at: repo.updated_at || '',
          readme_summary: buildReadmeSummary(readmeText, repo.description),
          facts: extractFactsFromReadme(readmeText, repo.description),
          source: 'github',
          pinned: (repo.stargazers_count || 0) > 0
        };
      })
    );

    const detectedSkills = Array.from(
      new Set(projects.flatMap((p) => p.verified_skills || []))
    );

    return res.status(200).json({
      ok: true,
      username: resolvedUsername,
      total_imported: projects.length,
      projects,
      detected_skills: detectedSkills
    });
  } catch (err) {
    const status = err.status === 404 ? 404 : err.status === 401 ? 401 : 500;
    return res.status(status).json({
      error: err.message || 'Falha ao sincronizar repositórios do GitHub.'
    });
  }
};
