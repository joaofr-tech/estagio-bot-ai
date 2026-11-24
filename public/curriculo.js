/* =============================================================
   SONA RESUME STUDIO — CLIENT CONTROLLER (curriculo.js)
   ============================================================= */

let supabaseClient = null;
let currentUser = null;
let userCloudSettings = null;
let githubOAuthToken = '';
let activeJob = null;
let currentResumeState = null; // { id, vaga_id, idioma, resume_json, match_report, audit_report }
let masterProfile = createEmptyProfile();

function getStudioStorageKeys() {
  return window.SonaAuth.getUserScopedKeys(currentUser?.id || 'anon');
}

function createEmptyProfile() {
  return {
    basics: {
      name: '',
      email: '',
      phone: '',
      location: '',
      headline: '',
      linkedin: '',
      github: '',
      portfolio: '',
      summary: ''
    },
    education: [],
    experiences: [],
    projects: [],
    skills_whitelist: [],
    certifications: [],
    languages_spoken: [],
    github_username: ''
  };
}

function showToast(msg) {
  const el = document.getElementById('studio-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3600);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* =============================================================
   INICIALIZAÇÃO & SUPABASE AUTH
   ============================================================= */
async function initStudio() {
  // 0. Modo embutido dentro do dashboard.html (esconde sidebar duplicada)
  const initParams = new URLSearchParams(window.location.search);
  if (initParams.get('embed') === '1' || window.self !== window.top) {
    document.body.classList.add('is-embedded');
  }

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'SONA_SWITCH_VIEW' && event.data.view) {
      switchView(event.data.view);
    }
  });

  // 1. Configura PDF.js worker
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // 1.5 Exige sessão autenticada (SaaS fechado)
  const session = await window.SonaAuth.requireSession({
    onSessionUpdate: (newSession) => handleAuthSession(newSession)
  });
  if (!session) return;

  supabaseClient = window.SonaAuth.getClient();
  await handleAuthSession(session);
  loadLocalProfile();
  await Promise.all([pullCloudSettings(), pullCloudProfile(), pullCloudHistory()]);
  loadByokConfig();

  // 4. Carrega vaga da URL (?vaga_id=...) ou localStorage
  await loadTargetJobFromContext();

  // 5. Renderiza telas iniciais
  renderProfileForm();
  renderHistoryList();
  updateBadges();

  // Se o perfil ainda estiver vazio e não veio de uma vaga, sugere Onboarding
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  const vagaIdParam = params.get('vaga_id');

  if (viewParam === 'onboarding' || viewParam === 'profile' || viewParam === 'studio') {
    switchView(viewParam);
  } else if (!vagaIdParam && masterProfile.projects.length === 0 && !masterProfile.basics.name) {
    switchView('onboarding');
  }

  // 6. Auto-carregar ou auto-gerar currículo ao abrir vindo de uma vaga (?vaga_id=...)
  if (vagaIdParam && activeJob && viewParam !== 'onboarding' && viewParam !== 'profile') {
    const existing = getLocalHistory().find(
      (h) => h.vaga_id === vagaIdParam || h.vaga_id === activeJob.id || h.vaga_id === activeJob.canonicalKey
    );
    if (existing) {
      currentResumeState = existing;
      renderTransparencyPanel(existing.match_report, existing.audit_report);
      renderResumeSheet(existing.resume_json);
      showToast(`Currículo salvo carregado para ${activeJob.empresa || 'esta vaga'}!`);
    } else {
      const byok = getByokConfig();
      const hasFacts = (masterProfile.projects || []).length > 0 || (masterProfile.experiences || []).length > 0;
      if (byok.apiKey && hasFacts) {
        showToast(`Gerando currículo ATS automaticamente para ${activeJob.empresa || 'esta vaga'}...`);
        await generateATSResume();
      } else {
        showToast('Finalize o Onboarding (IA + Banco de Fatos) para gerar automaticamente.');
      }
    }
  }
}

async function handleAuthSession(session) {
  if (!session?.user) return;
  const prevUserId = currentUser?.id;
  currentUser = session.user;
  githubOAuthToken = session.provider_token || '';

  if (prevUserId && prevUserId !== currentUser.id) {
    userCloudSettings = null;
    masterProfile = createEmptyProfile();
    currentResumeState = null;
    loadLocalProfile();
    await Promise.all([pullCloudSettings(), pullCloudProfile(), pullCloudHistory()]);
    loadByokConfig();
    renderProfileForm();
    renderHistoryList();
    updateBadges();
  }

  const identity = window.SonaAuth.deriveUserIdentity(currentUser, userCloudSettings);
  const dot = document.getElementById('auth-dot');
  const nameEl = document.getElementById('auth-user-name');
  const modeEl = document.getElementById('auth-mode-label');

  if (dot) dot.classList.remove('local');
  if (nameEl) nameEl.textContent = identity.displayName;
  if (modeEl) modeEl.textContent = githubOAuthToken ? 'Supabase + GitHub OAuth' : 'Sincronizado na nuvem';

  const ghInput = document.getElementById('gh-username');
  if (ghInput && !ghInput.value && currentUser.user_metadata?.user_name) {
    ghInput.value = currentUser.user_metadata.user_name;
  }
}

async function loginWithGitHub() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'github',
    options: {
      scopes: 'read:user repo',
      redirectTo: window.location.origin + window.location.pathname + window.location.search
    }
  });
  if (error) showToast(`Erro ao conectar GitHub: ${error.message}`);
}

async function logoutSupabase() {
  await window.SonaAuth.signOut('/auth.html');
}

/* =============================================================
   NAVEGAÇÃO & STEPPER
   ============================================================= */
function switchView(viewName) {
  ['studio', 'onboarding', 'profile'].forEach((v) => {
    document.getElementById(`view-${v}`)?.classList.toggle('active', v === viewName);
    document.getElementById(`nav-${v}`)?.classList.toggle('active', v === viewName);
  });
  if (viewName === 'profile') renderProfileForm();
}

function toggleStudioDrawer(drawerId) {
  const drawers = ['drawer-analysis', 'drawer-history'];
  drawers.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === drawerId) {
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    } else {
      el.style.display = 'none';
    }
  });
}

function toggleStudioMoreMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('studio-more-menu');
  if (menu) menu.classList.toggle('open');
}

function closeStudioMoreMenu() {
  document.getElementById('studio-more-menu')?.classList.remove('open');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest?.('.studio-more-wrap')) {
    closeStudioMoreMenu();
  }
});

function goToStep(stepNum) {
  for (let i = 1; i <= 4; i++) {
    document.getElementById(`step-panel-${i}`)?.classList.toggle('active', i === stepNum);
    document.getElementById(`pill-step-${i}`)?.classList.toggle('active', i === stepNum);
  }
}

function updateBadges() {
  const projCount = (masterProfile.projects || []).length;
  const badgeProj = document.getElementById('badge-projects-count');
  if (badgeProj) badgeProj.textContent = `${projCount} proj`;

  const byok = getByokConfig();
  let doneSteps = 0;
  if (byok.apiKey) { doneSteps++; document.getElementById('pill-step-1')?.classList.add('done'); }
  if (projCount > 0) { doneSteps++; document.getElementById('pill-step-2')?.classList.add('done'); }
  if ((masterProfile.education || []).length > 0 || (masterProfile.experiences || []).length > 0) {
    doneSteps++;
    document.getElementById('pill-step-3')?.classList.add('done');
  }
  if ((masterProfile.skills_whitelist || []).length > 0) {
    doneSteps++;
    document.getElementById('pill-step-4')?.classList.add('done');
  }

  const badgeOnb = document.getElementById('badge-onboarding-status');
  if (badgeOnb) badgeOnb.textContent = `${doneSteps}/4`;
}

/* =============================================================
   BYOK CONFIG (PASSO 1)
   ============================================================= */
async function pullCloudSettings() {
  if (!supabaseClient || !currentUser) return;
  const { data } = await supabaseClient
    .from('user_settings')
    .select('display_name, handle, avatar_url, daily_goal, byok_provider, byok_model')
    .eq('user_id', currentUser.id)
    .maybeSingle();
  if (data) {
    userCloudSettings = data;
    await handleAuthSession({ user: currentUser, provider_token: githubOAuthToken });
  }
}

function getByokConfig() {
  const keys = getStudioStorageKeys();
  let local = {};
  try {
    local = JSON.parse(localStorage.getItem(keys.BYOK_KEY) || '{}');
  } catch (_) {}
  return {
    provider: local.provider || userCloudSettings?.byok_provider || 'gemini',
    model: local.model || userCloudSettings?.byok_model || 'gemini-2.5-flash',
    apiKey: local.apiKey || ''
  };
}

function getSelectedModel(provider) {
  if (provider === 'gemini') {
    const sel = document.getElementById('byok-model-select');
    return sel ? sel.value : 'gemini-3.8-flash';
  }
  return document.getElementById('byok-model').value.trim();
}

function loadByokConfig() {
  const cfg = getByokConfig();
  if (cfg.provider) document.getElementById('byok-provider').value = cfg.provider;
  if (cfg.apiKey) document.getElementById('byok-key').value = cfg.apiKey;
  onProviderChange();
  if (cfg.model) {
    if ((cfg.provider || 'gemini') === 'gemini') {
      const sel = document.getElementById('byok-model-select');
      if (sel) {
        if (!Array.from(sel.options).some((o) => o.value === cfg.model)) {
          const opt = document.createElement('option');
          opt.value = cfg.model;
          opt.textContent = `${cfg.model} (Gratuito)`;
          sel.appendChild(opt);
        }
        sel.value = cfg.model;
      }
    } else {
      document.getElementById('byok-model').value = cfg.model;
    }
  }
}

function onProviderChange() {
  const provider = document.getElementById('byok-provider').value;
  const sel = document.getElementById('byok-model-select');
  const inp = document.getElementById('byok-model');
  const refreshBtn = document.getElementById('btn-refresh-models');
  const isGemini = provider === 'gemini';

  if (sel) sel.style.display = isGemini ? 'block' : 'none';
  if (refreshBtn) refreshBtn.style.display = isGemini ? 'inline' : 'none';
  if (inp) inp.style.display = isGemini ? 'none' : 'block';

  const defaults = {
    gemini: 'Padrão: gemini-3.8-flash',
    openai: 'Padrão: gpt-4o-mini',
    groq: 'Padrão: llama-3.3-70b-versatile',
    openrouter: 'Padrão: google/gemini-2.0-flash-001'
  };
  if (inp) inp.placeholder = defaults[provider] || '';
}

async function refreshGeminiFreeModels() {
  const apiKey = document.getElementById('byok-key').value.trim();
  const statusEl = document.getElementById('byok-status-msg');
  if (!apiKey) {
    statusEl.textContent = 'Cole sua API Key do Gemini primeiro para consultar os modelos gratuitos disponíveis.';
    return;
  }
  statusEl.textContent = 'Consultando modelos gratuitos disponíveis na sua chave Google...';
  try {
    const res = await fetch('/api/generate-resume', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LLM-Provider': 'gemini',
        'X-LLM-Key': apiKey
      },
      body: JSON.stringify({ action: 'list_models' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao listar modelos.');
    const sel = document.getElementById('byok-model-select');
    const prevVal = sel.value;
    if (Array.isArray(data.models) && data.models.length > 0) {
      sel.innerHTML = data.models
        .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}${m.id === 'gemini-3.8-flash' ? ' · Padrão' : ''}</option>`)
        .join('');
      if (data.models.some((m) => m.id === prevVal)) sel.value = prevVal;
      statusEl.textContent = `${data.models.length} modelos gratuitos carregados da sua conta Google.`;
    } else {
      statusEl.textContent = 'Nenhum modelo gratuito extra encontrado; mantendo lista padrão.';
    }
  } catch (err) {
    statusEl.textContent = `Erro: ${err.message}`;
  }
}

async function saveAndTestKey() {
  const provider = document.getElementById('byok-provider').value;
  const model = getSelectedModel(provider);
  const apiKey = document.getElementById('byok-key').value.trim();
  const statusEl = document.getElementById('byok-status-msg');
  const btn = document.getElementById('btn-test-key');

  if (!apiKey) {
    statusEl.textContent = 'Cole sua chave de API antes de testar.';
    return;
  }

  localStorage.setItem(getStudioStorageKeys().BYOK_KEY, JSON.stringify({ provider, model, apiKey }));
  if (userCloudSettings) {
    userCloudSettings.byok_provider = provider;
    userCloudSettings.byok_model = model;
  }
  if (supabaseClient && currentUser) {
    supabaseClient.from('user_settings').upsert({
      user_id: currentUser.id,
      byok_provider: provider,
      byok_model: model
    }).then(() => {}, () => {});
  }
  btn.disabled = true;
  statusEl.textContent = `Testando conexão com ${model || provider}...`;

  try {
    const res = await fetch('/api/generate-resume', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LLM-Provider': provider,
        'X-LLM-Key': apiKey,
        'X-LLM-Model': model
      },
      body: JSON.stringify({ action: 'test_key' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Chave inválida.');
    statusEl.textContent = `Conectado com sucesso (${data.model || provider}).`;
    showToast('Chave de IA validada e salva.');
    updateBadges();
  } catch (err) {
    statusEl.textContent = `Erro: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

/* =============================================================
   PERSISTÊNCIA DO BANCO DE FATOS (LOCAL + SUPABASE CLOUD)
   ============================================================= */
function loadLocalProfile() {
  try {
    const keys = getStudioStorageKeys();
    const raw = localStorage.getItem(keys.PROFILE);
    if (raw) {
      masterProfile = { ...createEmptyProfile(), ...JSON.parse(raw) };
      deduplicateMasterProfile(masterProfile);
      localStorage.setItem(keys.PROFILE, JSON.stringify(masterProfile));
    } else {
      masterProfile = createEmptyProfile();
    }
  } catch (_) {}
}

async function persistProfile() {
  localStorage.setItem(getStudioStorageKeys().PROFILE, JSON.stringify(masterProfile));
  updateBadges();

  if (supabaseClient && currentUser) {
    const { error } = await supabaseClient.from('master_profiles').upsert({
      user_id: currentUser.id,
      basics: masterProfile.basics,
      education: masterProfile.education,
      experiences: masterProfile.experiences,
      projects: masterProfile.projects,
      skills_whitelist: masterProfile.skills_whitelist,
      certifications: masterProfile.certifications,
      languages_spoken: masterProfile.languages_spoken,
      github_username: masterProfile.github_username || ''
    });
    if (error) {
      console.warn('Sync Supabase master_profiles:', error.message);
    }
  }
}

async function pullCloudProfile() {
  if (!supabaseClient || !currentUser) return;
  const { data, error } = await supabaseClient
    .from('master_profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (!error && data) {
    masterProfile = {
      ...createEmptyProfile(),
      ...data
    };
    localStorage.setItem(getStudioStorageKeys().PROFILE, JSON.stringify(masterProfile));
  }
}

async function pullCloudHistory() {
  if (!supabaseClient || !currentUser) return;
  const { data, error } = await supabaseClient
    .from('curriculos_gerados')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(25);
  if (!error && Array.isArray(data) && data.length > 0) {
    localStorage.setItem(getStudioStorageKeys().HISTORY, JSON.stringify(data));
  }
}

function normDedup(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(de|da|do|das|dos|em|e|para|com|a|o|of|in|the|and|at|bacharelado|graduacao|tecnologo|curso|bachelor|degree|pontificia|universidade|catolica)\b/g, ' ')
    .replace(/\bmonitoria\b/g, 'monitor')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensSimilar(a, b) {
  const na = normDedup(a);
  const nb = normDedup(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 5 && nb.length >= 5 && (na.includes(nb) || nb.includes(na))) return true;
  const ta = new Set(na.split(' ').filter((w) => w.length >= 2));
  const tb = new Set(nb.split(' ').filter((w) => w.length >= 2));
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  ta.forEach((w) => { if (tb.has(w)) inter++; });
  const minSize = Math.min(ta.size, tb.size);
  return inter / minSize >= 0.6;
}

function pickRicher(a, b) {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  return sb.length > sa.length ? sb : sa;
}

function mergeUniqueStrings(arrA = [], arrB = []) {
  const out = [];
  const seen = new Set();
  for (const item of [...arrA, ...arrB]) {
    const clean = String(item || '').trim();
    const key = normDedup(clean);
    if (clean && key && !seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  }
  return out;
}

function deduplicateMasterProfile(profile) {
  if (!profile) return;

  // 1. Formação Acadêmica (mescla variações como "PUC Minas" vs "Pontifícia Universidade Católica...")
  const dedupEdu = [];
  for (const edu of profile.education || []) {
    const courseA = `${edu.degree || ''} ${edu.field || ''}`.trim();
    const existing = dedupEdu.find((ex) => {
      const courseB = `${ex.degree || ''} ${ex.field || ''}`.trim();
      const sameCourse = tokensSimilar(courseA, courseB);
      const sameInst = tokensSimilar(edu.institution, ex.institution);
      return (sameCourse && sameInst) || (sameCourse && courseA.length >= 10);
    });
    if (existing) {
      existing.institution = pickRicher(existing.institution, edu.institution);
      existing.degree = pickRicher(existing.degree, edu.degree);
      existing.field = pickRicher(existing.field, edu.field);
      existing.start_date = existing.start_date || edu.start_date || '';
      existing.end_date = existing.end_date || edu.end_date || '';
      existing.highlights = mergeUniqueStrings(existing.highlights, edu.highlights);
    } else {
      dedupEdu.push({ ...edu });
    }
  }
  profile.education = dedupEdu;

  // 2. Experiências (mescla duplicatas como "Monitor" vs "Monitoria de ...")
  const dedupExp = [];
  for (const exp of profile.experiences || []) {
    const existing = dedupExp.find((ex) => {
      const sameRole = tokensSimilar(exp.role, ex.role);
      const sameComp = tokensSimilar(exp.company, ex.company);
      const samePeriod = exp.start_date && ex.start_date && normDedup(exp.start_date) === normDedup(ex.start_date);
      return (sameRole && sameComp) || (sameRole && samePeriod) || (sameRole && normDedup(exp.role).includes('monitor') && normDedup(ex.role).includes('monitor'));
    });
    if (existing) {
      existing.company = pickRicher(existing.company, exp.company);
      existing.role = pickRicher(existing.role, exp.role);
      existing.location = pickRicher(existing.location, exp.location);
      existing.start_date = existing.start_date || exp.start_date || '';
      existing.end_date = existing.end_date || exp.end_date || '';
      existing.facts = mergeUniqueStrings(existing.facts, exp.facts);
      existing.verified_skills = mergeUniqueStrings(existing.verified_skills, exp.verified_skills);
    } else {
      dedupExp.push({ ...exp });
    }
  }
  profile.experiences = dedupExp;

  // 3. Projetos
  const dedupProj = [];
  for (const proj of profile.projects || []) {
    const existing = dedupProj.find(
      (ex) =>
        (proj.repo_full_name && ex.repo_full_name && proj.repo_full_name.toLowerCase() === ex.repo_full_name.toLowerCase()) ||
        tokensSimilar(proj.name, ex.name)
    );
    if (existing) {
      existing.url = existing.url || proj.url || '';
      existing.readme_summary = pickRicher(existing.readme_summary, proj.readme_summary);
      existing.languages = mergeUniqueStrings(existing.languages, proj.languages);
      existing.verified_skills = mergeUniqueStrings(existing.verified_skills, proj.verified_skills);
      existing.facts = mergeUniqueStrings(existing.facts, proj.facts);
    } else {
      dedupProj.push({ ...proj });
    }
  }
  profile.projects = dedupProj;

  // 4. Certificados
  const dedupCert = [];
  for (const cert of profile.certifications || []) {
    const existing = dedupCert.find((ex) => tokensSimilar(cert.name, ex.name));
    if (existing) {
      existing.name = pickRicher(existing.name, cert.name);
      existing.authority = pickRicher(existing.authority, cert.authority);
      existing.date = existing.date || cert.date || '';
      existing.url = existing.url || cert.url || '';
    } else {
      dedupCert.push({ ...cert });
    }
  }
  profile.certifications = dedupCert;
}

function mergeIntoMasterProfile(patch) {
  if (!patch) return;

  // Basics: preenche apenas campos vazios para não sobrescrever edições manuais
  if (patch.basics) {
    for (const [k, v] of Object.entries(patch.basics)) {
      if (v && !masterProfile.basics[k]) {
        masterProfile.basics[k] = v;
      }
    }
  }

  if (patch.education?.length) {
    masterProfile.education = [...(masterProfile.education || []), ...patch.education];
  }
  if (patch.experiences?.length) {
    masterProfile.experiences = [...(masterProfile.experiences || []), ...patch.experiences];
  }
  if (patch.projects?.length) {
    masterProfile.projects = [...(masterProfile.projects || []), ...patch.projects];
  }
  if (patch.skills_whitelist?.length) {
    masterProfile.skills_whitelist = mergeUniqueStrings(masterProfile.skills_whitelist, patch.skills_whitelist);
  }
  if (patch.certifications?.length) {
    masterProfile.certifications = [...(masterProfile.certifications || []), ...patch.certifications];
  }
  if (patch.languages_spoken?.length) {
    const seen = new Set((masterProfile.languages_spoken || []).map((l) => normDedup(l.name)));
    for (const lang of patch.languages_spoken) {
      if (lang.name && !seen.has(normDedup(lang.name))) {
        seen.add(normDedup(lang.name));
        masterProfile.languages_spoken.push(lang);
      }
    }
  }

  // Deduplicação inteligente após mesclar todas as fontes
  deduplicateMasterProfile(masterProfile);
}

/* =============================================================
   PASSO 2: GITHUB SMART REPO PICKER + SYNC (OAUTH OU USERNAME)
   ============================================================= */
let discoveredGhRepos = [];
let selectedGhRepoNames = new Set();

async function loadGitHubRepoList() {
  const username = document.getElementById('gh-username').value.trim();
  const statusEl = document.getElementById('gh-status-msg');
  const btn = document.getElementById('btn-list-gh');

  if (!username && !githubOAuthToken) {
    statusEl.textContent = 'Informe seu username do GitHub ou conecte via OAuth.';
    return;
  }

  btn.disabled = true;
  statusEl.textContent = 'Listando repositórios e classificando projetos...';

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (githubOAuthToken) headers['X-GitHub-Token'] = githubOAuthToken;

    const res = await fetch('/api/github-sync', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'list', username })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao listar repositórios.');

    discoveredGhRepos = data.repos || [];
    selectedGhRepoNames = new Set();
    const existingGhNames = new Set(
      (masterProfile.projects || [])
        .filter((p) => p.source === 'github' && p.repo_full_name)
        .map((p) => p.repo_full_name.toLowerCase())
    );

    const recs = discoveredGhRepos.filter((r) => r.recommended);
    const defaultPick = recs.length > 0 ? recs : discoveredGhRepos.filter((r) => !r.noise_reason).slice(0, 6);
    defaultPick.forEach((r) => selectedGhRepoNames.add(r.full_name));

    discoveredGhRepos.forEach((r) => {
      if (!r.noise_reason && existingGhNames.has(r.full_name.toLowerCase())) {
        selectedGhRepoNames.add(r.full_name);
      }
    });

    document.getElementById('gh-repo-picker').style.display = 'block';
    renderGitHubRepoPicker();
    statusEl.textContent = `${discoveredGhRepos.length} repositórios encontrados; ${selectedGhRepoNames.size} selecionados automaticamente.`;
  } catch (err) {
    statusEl.textContent = `Erro: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function renderGitHubRepoPicker() {
  const grid = document.getElementById('gh-repo-grid');
  const query = (document.getElementById('gh-repo-search')?.value || '').trim().toLowerCase();
  if (!grid) return;

  const filtered = discoveredGhRepos.filter((r) => {
    if (!query) return true;
    const hay = `${r.name} ${r.description} ${r.language} ${(r.topics || []).join(' ')}`.toLowerCase();
    return hay.includes(query);
  });

  if (filtered.length === 0) {
    grid.innerHTML = '<p class="field-hint">Nenhum repositório corresponde ao filtro.</p>';
  } else {
    grid.innerHTML = filtered.map((r) => {
      const checked = selectedGhRepoNames.has(r.full_name);
      const safeFull = escapeHtml(r.full_name);
      const updated = r.pushed_at ? new Date(r.pushed_at).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : '';
      return `
        <div class="repo-pick-card ${checked ? 'selected' : ''} ${r.noise_reason ? 'is-noise' : ''}" onclick="toggleRepoSelection('${safeFull}')">
          <input type="checkbox" ${checked ? 'checked' : ''} onclick="event.stopPropagation(); toggleRepoSelection('${safeFull}')">
          <div style="min-width:0; flex:1;">
            <div class="repo-pick-name">${escapeHtml(r.name)}</div>
            <div class="repo-pick-desc">${escapeHtml(r.description || 'Sem descrição no GitHub')}</div>
            <div class="repo-pick-meta">
              ${r.recommended ? '<span class="repo-badge rec">Recomendado</span>' : ''}
              ${r.noise_reason ? `<span class="repo-badge noise">${escapeHtml(r.noise_reason)}</span>` : ''}
              ${r.language ? `<span class="repo-badge">${escapeHtml(r.language)}</span>` : ''}
              ${r.stars > 0 ? `<span class="repo-badge">${r.stars} stars</span>` : ''}
              ${updated ? `<span class="field-hint" style="font-size:0.68rem;">${updated}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  const count = selectedGhRepoNames.size;
  const countEl = document.getElementById('gh-selection-count');
  const importBtn = document.getElementById('btn-sync-gh');
  if (countEl) countEl.textContent = `${count} repositório(s) selecionado(s) de ${discoveredGhRepos.length}`;
  if (importBtn) {
    importBtn.textContent = `Importar Selecionados (${count})`;
    importBtn.disabled = count === 0;
  }
}

function toggleRepoSelection(fullName) {
  if (selectedGhRepoNames.has(fullName)) {
    selectedGhRepoNames.delete(fullName);
  } else {
    selectedGhRepoNames.add(fullName);
  }
  renderGitHubRepoPicker();
}

function applyRepoSelectionPreset(mode) {
  selectedGhRepoNames = new Set();
  if (mode === 'recommended') {
    discoveredGhRepos.filter((r) => r.recommended).forEach((r) => selectedGhRepoNames.add(r.full_name));
  } else if (mode === 'all') {
    discoveredGhRepos.forEach((r) => selectedGhRepoNames.add(r.full_name));
  }
  renderGitHubRepoPicker();
}

async function importSelectedGitHubRepos() {
  const username = document.getElementById('gh-username').value.trim();
  const statusEl = document.getElementById('gh-status-msg');
  const btn = document.getElementById('btn-sync-gh');
  const selectedList = Array.from(selectedGhRepoNames);

  if (selectedList.length === 0) {
    statusEl.textContent = 'Selecione pelo menos 1 repositório para importar.';
    return;
  }

  btn.disabled = true;
  btn.textContent = `Lendo ${selectedList.length} projetos...`;
  statusEl.textContent = `Extraindo linguagens e README.md dos ${selectedList.length} projetos escolhidos...`;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (githubOAuthToken) headers['X-GitHub-Token'] = githubOAuthToken;

    const res = await fetch('/api/github-sync', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'import',
        username,
        selected_repos: selectedList
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao importar repositórios.');

    if (data.username) {
      masterProfile.github_username = data.username;
      if (!masterProfile.basics.github) {
        masterProfile.basics.github = `https://github.com/${data.username}`;
      }
    }

    masterProfile.projects = (masterProfile.projects || []).filter((p) => p.source !== 'github');
    mergeIntoMasterProfile({
      projects: data.projects,
      skills_whitelist: data.detected_skills
    });
    await persistProfile();
    renderProfileForm();

    statusEl.textContent = `${data.total_imported} projetos selecionados importados com sucesso.`;
    showToast(`${data.total_imported} projetos do GitHub atualizados.`);
  } catch (err) {
    statusEl.textContent = `Erro: ${err.message}`;
  } finally {
    btn.disabled = false;
    renderGitHubRepoPicker();
  }
}

/* =============================================================
   PASSO 3: LINKEDIN ZIP (CSV DETERMINÍSTICO NO BROWSER) & PDF
   ============================================================= */
function parseCsvClient(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field.trim()); field = ''; }
      else if (ch === '\r' && next === '\n') { row.push(field.trim()); rows.push(row); row = []; field = ''; i++; }
      else if (ch === '\n' || ch === '\r') { row.push(field.trim()); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field.trim()); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some(Boolean)).map((vals) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });
}

function pickCol(row, names) {
  const keys = Object.keys(row);
  for (const n of names) {
    if (row[n]) return row[n];
    const k = keys.find((x) => x.toLowerCase() === n.toLowerCase());
    if (k && row[k]) return row[k];
  }
  return '';
}

function setDropzoneState(inputEl, state, message) {
  const zone = inputEl?.closest('.dropzone');
  if (!zone) return;
  zone.classList.remove('is-loading', 'is-done', 'is-error');
  if (state) zone.classList.add(`is-${state}`);

  let fb = zone.querySelector('.dropzone-feedback');
  if (!fb) {
    fb = document.createElement('span');
    fb.className = 'dropzone-feedback';
    zone.appendChild(fb);
  }
  fb.textContent = message || '';
}

async function handleLinkedInZipUpload(event) {
  const inputEl = event.target;
  const file = inputEl.files?.[0];
  if (!file) return;
  const statusEl = document.getElementById('li-status-msg');
  const loadingMsg = `Processando "${file.name}" localmente...`;
  statusEl.textContent = loadingMsg;
  setDropzoneState(inputEl, 'loading', loadingMsg);

  try {
    const zip = await window.JSZip.loadAsync(file);
    const readCsv = async (regex) => {
      const entry = Object.values(zip.files).find((f) => !f.dir && regex.test(f.name.toLowerCase()));
      if (!entry) return [];
      const content = await entry.async('string');
      return parseCsvClient(content);
    };

    const [profileRows, posRows, eduRows, skillRows, certRows, projRows] = await Promise.all([
      readCsv(/(^|\/)profile\.csv$/),
      readCsv(/(^|\/)positions\.csv$/),
      readCsv(/(^|\/)education\.csv$/),
      readCsv(/(^|\/)skills\.csv$/),
      readCsv(/(^|\/)certifications\.csv$/),
      readCsv(/(^|\/)projects\.csv$/)
    ]);

    const patch = {
      basics: {},
      education: [],
      experiences: [],
      projects: [],
      skills_whitelist: [],
      certifications: []
    };

    if (profileRows[0]) {
      const p = profileRows[0];
      const name = [pickCol(p, ['First Name', 'Nome']), pickCol(p, ['Last Name', 'Sobrenome'])].filter(Boolean).join(' ');
      if (name) patch.basics.name = name;
      patch.basics.headline = pickCol(p, ['Headline', 'Título']);
      patch.basics.location = pickCol(p, ['Geo Location', 'Localização']);
      patch.basics.summary = pickCol(p, ['Summary', 'Resumo']);
    }

    patch.experiences = posRows.map((r, i) => ({
      id: `li-exp-${i + 1}`,
      company: pickCol(r, ['Company Name', 'Empresa']),
      role: pickCol(r, ['Title', 'Cargo']),
      start_date: pickCol(r, ['Started On', 'Data de início']),
      end_date: pickCol(r, ['Finished On', 'Data de término']) || 'Atual',
      facts: pickCol(r, ['Description', 'Descrição']).split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length >= 6),
      verified_skills: [],
      source: 'linkedin_zip'
    })).filter((e) => e.company || e.role);

    patch.education = eduRows.map((r, i) => ({
      id: `li-edu-${i + 1}`,
      institution: pickCol(r, ['School Name', 'Instituição de ensino']),
      degree: pickCol(r, ['Degree Name', 'Formação']),
      field: pickCol(r, ['Field Of Study', 'Área de estudo']),
      start_date: pickCol(r, ['Start Date', 'Data de início']),
      end_date: pickCol(r, ['End Date', 'Data de término']),
      highlights: [],
      source: 'linkedin_zip'
    })).filter((e) => e.institution);

    patch.skills_whitelist = skillRows.map((r) => pickCol(r, ['Name', 'Nome', 'Skill'])).filter(Boolean);

    patch.certifications = certRows.map((r, i) => ({
      id: `li-cert-${i + 1}`,
      name: pickCol(r, ['Name', 'Nome']),
      authority: pickCol(r, ['Authority', 'Organização emissora']),
      date: pickCol(r, ['Started On', 'Data de emissão']),
      source: 'linkedin_zip'
    })).filter((c) => c.name);

    patch.projects = projRows.map((r, i) => ({
      id: `li-proj-${i + 1}`,
      name: pickCol(r, ['Title', 'Título']),
      url: pickCol(r, ['Url', 'URL']),
      languages: [],
      verified_skills: [],
      readme_summary: pickCol(r, ['Description', 'Descrição']),
      facts: pickCol(r, ['Description', 'Descrição']).split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length >= 6),
      source: 'linkedin_zip'
    })).filter((p) => p.name);

    mergeIntoMasterProfile(patch);
    await persistProfile();
    renderProfileForm();

    const okMsg = `"${file.name}" importado: ${patch.experiences.length} exp, ${patch.education.length} formações, ${patch.skills_whitelist.length} skills.`;
    statusEl.textContent = okMsg;
    setDropzoneState(inputEl, 'done', okMsg);
    showToast('Dados do LinkedIn mesclados.');
  } catch (err) {
    const errMsg = `Erro ao ler ZIP: ${err.message}`;
    statusEl.textContent = errMsg;
    setDropzoneState(inputEl, 'error', errMsg);
  } finally {
    inputEl.value = '';
  }
}

async function extractTextFromPdfFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    fullText += content.items.map((item) => item.str).join(' ') + '\n';
  }
  return fullText.trim();
}

async function handlePdfUpload(event, sourceTag) {
  const inputEl = event.target;
  const file = inputEl.files?.[0];
  if (!file) return;
  const statusEl = document.getElementById(sourceTag === 'linkedin_pdf' ? 'li-status-msg' : 'base-status-msg');
  const byok = getByokConfig();

  if (!byok.apiKey) {
    const warnMsg = 'Configure sua chave de IA no Passo 1 antes de importar PDF.';
    statusEl.textContent = warnMsg;
    setDropzoneState(inputEl, 'error', warnMsg);
    inputEl.value = '';
    return;
  }

  const loadingMsg = `Lendo "${file.name}" e extraindo fatos...`;
  statusEl.textContent = loadingMsg;
  setDropzoneState(inputEl, 'loading', loadingMsg);
  showToast(`Processando "${file.name}"...`);

  try {
    const text = await extractTextFromPdfFile(file);
    const res = await fetch('/api/parse-resume-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LLM-Provider': byok.provider || 'gemini',
        'X-LLM-Key': byok.apiKey,
        'X-LLM-Model': byok.model || ''
      },
      body: JSON.stringify({ text, sourceTag })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao interpretar PDF.');

    const patch = data.profile_patch || {};
    mergeIntoMasterProfile(patch);
    await persistProfile();
    renderProfileForm();

    const summaryCounts = `${(patch.education || []).length} formações, ${(patch.experiences || []).length} exp, ${(patch.projects || []).length} projetos, ${(patch.skills_whitelist || []).length} skills`;
    const okMsg = `"${file.name}" importado (${summaryCounts}).`;
    statusEl.textContent = okMsg;
    setDropzoneState(inputEl, 'done', okMsg);
    showToast('Fatos do PDF extraídos.');
  } catch (err) {
    const errMsg = `Erro: ${err.message}`;
    statusEl.textContent = errMsg;
    setDropzoneState(inputEl, 'error', errMsg);
    showToast(errMsg);
  } finally {
    inputEl.value = '';
  }
}

/* =============================================================
   BANCO DE FATOS (VIEW 3)
   ============================================================= */
function renderProfileForm() {
  const b = masterProfile.basics || {};
  document.getElementById('mp-name').value = b.name || '';
  document.getElementById('mp-email').value = b.email || '';
  document.getElementById('mp-phone').value = b.phone || '';
  document.getElementById('mp-location').value = b.location || '';
  document.getElementById('mp-linkedin').value = b.linkedin || '';
  document.getElementById('mp-github').value = b.github || '';
  document.getElementById('mp-skills').value = (masterProfile.skills_whitelist || []).join(', ');

  // Education
  const eduBox = document.getElementById('mp-education-list');
  if ((masterProfile.education || []).length === 0) {
    eduBox.innerHTML = '<p class="field-hint">Nenhuma formação cadastrada ainda. Adicione sua graduação acima.</p>';
  } else {
    eduBox.innerHTML = masterProfile.education.map((edu, idx) => `
      <div class="fact-item-card">
        <div class="fact-item-head">
          <div>
            <strong>${escapeHtml(edu.degree)} ${edu.field ? `em ${escapeHtml(edu.field)}` : ''}</strong>
            <div class="field-hint">${escapeHtml(edu.institution)} · ${escapeHtml(edu.start_date)} – ${escapeHtml(edu.end_date || 'Atual')}</div>
          </div>
          <div style="display:flex; gap:0.4rem; align-items:center;">
            <span class="source-tag">${escapeHtml(edu.source || 'manual')}</span>
            <button class="btn-danger-ghost" onclick="removeProfileItem('education', ${idx})">Remover</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  // Projects
  const projBox = document.getElementById('mp-projects-list');
  if ((masterProfile.projects || []).length === 0) {
    projBox.innerHTML = '<p class="field-hint">Nenhum projeto cadastrado. Importe do GitHub no Passo 2 ou adicione manualmente.</p>';
  } else {
    projBox.innerHTML = masterProfile.projects.map((p, idx) => `
      <div class="fact-item-card">
        <div class="fact-item-head">
          <div>
            <strong>${escapeHtml(p.name)}</strong>
            ${p.url ? `<a href="${escapeHtml(p.url)}" target="_blank" style="font-size:0.75rem; margin-left:0.4rem; color:var(--brand-primary);">↗ repo</a>` : ''}
            <div class="chip-list" style="margin-top:0.35rem;">
              ${(p.verified_skills || p.languages || []).map((t) => `<span class="chip neutral">${escapeHtml(t)}</span>`).join('')}
            </div>
          </div>
          <div style="display:flex; gap:0.4rem; align-items:center;">
            <span class="source-tag">${escapeHtml(p.source || 'manual')}</span>
            <button class="btn-danger-ghost" onclick="removeProfileItem('projects', ${idx})">Remover</button>
          </div>
        </div>
        <div class="field-hint" style="margin-top:0.35rem;">${escapeHtml((p.facts || []).slice(0, 2).join(' · ') || p.readme_summary || 'Sem descrição')}</div>
      </div>
    `).join('');
  }

  // Experiences
  const expBox = document.getElementById('mp-experiences-list');
  if ((masterProfile.experiences || []).length === 0) {
    expBox.innerHTML = '<p class="field-hint">Nenhuma experiência cadastrada (normal para primeiro estágio — o motor priorizará seus Projetos!).</p>';
  } else {
    expBox.innerHTML = masterProfile.experiences.map((e, idx) => `
      <div class="fact-item-card">
        <div class="fact-item-head">
          <div>
            <strong>${escapeHtml(e.role)} — ${escapeHtml(e.company)}</strong>
            <div class="field-hint">${escapeHtml(e.start_date)} – ${escapeHtml(e.end_date || 'Atual')}</div>
          </div>
          <div style="display:flex; gap:0.4rem; align-items:center;">
            <span class="source-tag">${escapeHtml(e.source || 'manual')}</span>
            <button class="btn-danger-ghost" onclick="removeProfileItem('experiences', ${idx})">Remover</button>
          </div>
        </div>
        <div class="field-hint">${escapeHtml((e.facts || []).slice(0, 2).join(' · '))}</div>
      </div>
    `).join('');
  }

  // Certifications
  const certBox = document.getElementById('mp-certifications-list');
  if (certBox) {
    if ((masterProfile.certifications || []).length === 0) {
      certBox.innerHTML = '<p class="field-hint">Nenhum certificado cadastrado ainda. Importe do LinkedIn/PDF ou adicione acima.</p>';
    } else {
      certBox.innerHTML = masterProfile.certifications.map((c, idx) => `
        <div class="fact-item-card">
          <div class="fact-item-head">
            <div>
              <strong>${escapeHtml(c.name)}</strong>
              <div class="field-hint">${escapeHtml([c.authority, c.date].filter(Boolean).join(' · '))}</div>
            </div>
            <div style="display:flex; gap:0.4rem; align-items:center;">
              <span class="source-tag">${escapeHtml(c.source || 'manual')}</span>
              <button class="btn-danger-ghost" onclick="removeProfileItem('certifications', ${idx})">Remover</button>
            </div>
          </div>
        </div>
      `).join('');
    }
  }

  // Languages
  const langBox = document.getElementById('mp-languages-list');
  if (langBox) {
    if ((masterProfile.languages_spoken || []).length === 0) {
      langBox.innerHTML = '<p class="field-hint">Nenhum idioma cadastrado ainda (ex: Português: nativo, Inglês: intermediário).</p>';
    } else {
      langBox.innerHTML = masterProfile.languages_spoken.map((l, idx) => `
        <div class="fact-item-card">
          <div class="fact-item-head">
            <div>
              <strong>${escapeHtml(l.name)}</strong>${l.proficiency ? `: ${escapeHtml(l.proficiency)}` : ''}
            </div>
            <button class="btn-danger-ghost" onclick="removeProfileItem('languages_spoken', ${idx})">Remover</button>
          </div>
        </div>
      `).join('');
    }
  }
}

async function addManualCertification() {
  const name = prompt('Nome do certificado / curso:');
  if (!name) return;
  const authority = prompt('Instituição emissora (ex: AWS, Alura, PUC Minas):') || '';
  const date = prompt('Ano / Data (opcional, ex: 2026):') || '';
  masterProfile.certifications.push({
    id: `manual-cert-${Date.now()}`,
    name: name.trim(),
    authority: authority.trim(),
    date: date.trim(),
    source: 'manual'
  });
  await persistProfile();
  renderProfileForm();
}

async function addManualLanguage() {
  const name = prompt('Idioma (ex: Inglês):');
  if (!name) return;
  const proficiency = prompt('Nível (ex: intermediário — leitura técnica de documentação):') || 'Intermediário';
  masterProfile.languages_spoken.push({
    name: name.trim(),
    proficiency: proficiency.trim()
  });
  await persistProfile();
  renderProfileForm();
}

async function saveMasterProfileForm() {
  masterProfile.basics.name = document.getElementById('mp-name').value.trim();
  masterProfile.basics.email = document.getElementById('mp-email').value.trim();
  masterProfile.basics.phone = document.getElementById('mp-phone').value.trim();
  masterProfile.basics.location = document.getElementById('mp-location').value.trim();
  masterProfile.basics.linkedin = document.getElementById('mp-linkedin').value.trim();
  masterProfile.basics.github = document.getElementById('mp-github').value.trim();

  const rawSkills = document.getElementById('mp-skills').value;
  masterProfile.skills_whitelist = Array.from(
    new Set(rawSkills.split(',').map((s) => s.trim()).filter(Boolean))
  );

  await persistProfile();
  showToast('Banco de Fatos salvo com sucesso!');
}

async function removeProfileItem(section, idx) {
  masterProfile[section].splice(idx, 1);
  await persistProfile();
  renderProfileForm();
}

async function addEducationItem() {
  const institution = prompt('Instituição de ensino (ex: PUC Minas):');
  if (!institution) return;
  const degree = prompt('Curso / Grau (ex: Bacharelado em Engenharia de Software):') || 'Graduação';
  const start = prompt('Início (ex: 2025):') || '';
  const end = prompt('Previsão de conclusão (ex: 2028):') || '';
  masterProfile.education.push({
    id: `manual-edu-${Date.now()}`,
    institution: institution.trim(),
    degree: degree.trim(),
    field: '',
    start_date: start.trim(),
    end_date: end.trim(),
    highlights: [],
    source: 'manual'
  });
  await persistProfile();
  renderProfileForm();
}

async function addManualProject() {
  const name = prompt('Nome do projeto:');
  if (!name) return;
  const techs = prompt('Tecnologias reais usadas (separadas por vírgula):') || '';
  const desc = prompt('O que esse projeto faz de verdade (fatos/resultados reais):') || '';
  const url = prompt('URL do projeto/repositório (opcional):') || '';
  const techList = techs.split(',').map((s) => s.trim()).filter(Boolean);
  masterProfile.projects.push({
    id: `manual-proj-${Date.now()}`,
    name: name.trim(),
    url: url.trim(),
    languages: techList,
    verified_skills: techList,
    readme_summary: desc.trim(),
    facts: desc.split('.').map((s) => s.trim()).filter((s) => s.length >= 6),
    source: 'manual'
  });
  mergeIntoMasterProfile({ skills_whitelist: techList });
  await persistProfile();
  renderProfileForm();
}

async function addManualExperience() {
  const company = prompt('Empresa / Organização:');
  if (!company) return;
  const role = prompt('Cargo / Papel:') || '';
  const period = prompt('Período (ex: Jan 2025 - Atual):') || '';
  const desc = prompt('Principais entregas reais (separe por ponto):') || '';
  const [start, end] = period.split('-').map((s) => s.trim());
  masterProfile.experiences.push({
    id: `manual-exp-${Date.now()}`,
    company: company.trim(),
    role: role.trim(),
    start_date: start || '',
    end_date: end || 'Atual',
    facts: desc.split('.').map((s) => s.trim()).filter((s) => s.length >= 6),
    verified_skills: [],
    source: 'manual'
  });
  await persistProfile();
  renderProfileForm();
}

async function loadSampleProfile() {
  masterProfile = {
    basics: {
      name: 'João Francisco',
      email: 'joao@exemplo.com',
      phone: '(31) 99999-0000',
      location: 'Belo Horizonte, MG',
      headline: 'Estudante de Engenharia de Software · Python, ETL & Web',
      linkedin: 'https://linkedin.com/in/joaofrancisco',
      github: 'https://github.com/joaofrancisco',
      summary: 'Estudante do 3º período de Engenharia de Software com foco em automação de dados, backend e aplicações web.'
    },
    education: [
      {
        id: 'edu-puc',
        institution: 'PUC Minas',
        degree: 'Bacharelado em Engenharia de Software',
        field: '3º período',
        start_date: '2025',
        end_date: 'Previsão 2028',
        highlights: [],
        source: 'manual'
      }
    ],
    experiences: [],
    projects: [
      {
        id: 'gh-sona',
        name: 'Sona — Pipeline ETL & Rastreador de Vagas',
        url: 'https://github.com/joaofrancisco/Estagio_Bot',
        languages: ['Python', 'JavaScript', 'HTML', 'CSS'],
        verified_skills: ['Python', 'Pydantic', 'Supabase', 'PostgreSQL', 'GitHub Actions', 'JavaScript'],
        readme_summary: 'Pipeline ETL paralelo em Python com validação Pydantic v2, carga idempotente no Supabase PostgreSQL, auditoria em fila circular e painel web interativo.',
        facts: [
          'Desenvolveu coletores paralelos em Python (httpx + ThreadPoolExecutor) para 5 portais de vagas com retentativas exponenciais.',
          'Implementou validação estrita com Pydantic v2, deduplicação determinística e carga idempotente via UPSERT no Supabase (PostgreSQL).',
          'Construiu painel web interativo com funil de candidaturas e observabilidade automatizada via GitHub Actions.'
        ],
        source: 'github'
      },
      {
        id: 'gh-api-tasks',
        name: 'TaskFlow API',
        url: 'https://github.com/joaofrancisco/taskflow-api',
        languages: ['JavaScript', 'SQL'],
        verified_skills: ['Node.js', 'REST API', 'SQL', 'Git'],
        readme_summary: 'API REST em Node.js com autenticação JWT e persistência relacional para organização de tarefas acadêmicas.',
        facts: [
          'Criou endpoints REST em Node.js com validação de payload e consultas parametrizadas em SQL.',
          'Estruturou testes automatizados para rotas críticas e documentação de uso.'
        ],
        source: 'github'
      }
    ],
    skills_whitelist: ['Python', 'JavaScript', 'SQL', 'PostgreSQL', 'Supabase', 'Pydantic', 'Node.js', 'REST API', 'Git', 'GitHub Actions', 'HTML', 'CSS'],
    certifications: [],
    languages_spoken: [{ name: 'Português', proficiency: 'Nativo' }, { name: 'Inglês', proficiency: 'Intermediário/Técnico' }],
    github_username: 'joaofrancisco'
  };
  await persistProfile();
  renderProfileForm();
  showToast('Perfil de exemplo carregado no Banco de Fatos!');
}

/* =============================================================
   VAGA ALVO & GERAÇÃO ATS (VIEW 1)
   ============================================================= */
async function loadTargetJobFromContext() {
  const params = new URLSearchParams(window.location.search);
  const vagaId = params.get('vaga_id');

  // 1. Tenta snapshot salvo pelo dashboard.html ao clicar em Inscrição
  try {
    const snapRaw =
      localStorage.getItem(getStudioStorageKeys().ACTIVE_JOB) ||
      localStorage.getItem('sona_active_resume_job');
    if (snapRaw) {
      const snap = JSON.parse(snapRaw);
      if (!vagaId || snap.id === vagaId || snap.canonicalKey === vagaId) {
        activeJob = snap;
      }
    }
  } catch (_) {}

  // 2. Se veio vaga_id e ainda não encontrou, tenta buscar na tabela vagas do Supabase
  if (!activeJob && vagaId && supabaseClient) {
    const { data } = await supabaseClient
      .from('vagas')
      .select('*')
      .eq('id', vagaId)
      .maybeSingle();
    if (data) activeJob = data;
  }

  if (activeJob) {
    document.getElementById('job-company').textContent = activeJob.empresa || 'Empresa';
    document.getElementById('job-title').textContent = activeJob.cargo || 'Vaga selecionada';
    document.getElementById('job-meta').textContent = [activeJob.modalidade, activeJob.localizacao, activeJob.turno]
      .filter(Boolean)
      .join(' · ');
  }
}

async function generateATSResume() {
  const byok = getByokConfig();
  if (!byok.apiKey) {
    showToast('Configure sua chave de IA em "Configurar fontes".');
    switchView('onboarding');
    goToStep(1);
    return;
  }

  if ((masterProfile.projects || []).length === 0 && (masterProfile.experiences || []).length === 0) {
    showToast('Adicione pelo menos 1 projeto ou experiência no Banco de fatos.');
    switchView('onboarding');
    goToStep(2);
    return;
  }

  const cargo = activeJob?.cargo || '';
  const jdText = activeJob?.requisitos || '';
  if (!jdText && !cargo) {
    showToast('Selecione uma vaga em andamento em "Meta do Dia" para gerar o currículo.');
    return;
  }

  const btn = document.getElementById('btn-generate-ats');
  btn.disabled = true;
  btn.textContent = 'Gerando...';

  try {
    const res = await fetch('/api/generate-resume', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LLM-Provider': byok.provider || 'gemini',
        'X-LLM-Key': byok.apiKey,
        'X-LLM-Model': byok.model || ''
      },
      body: JSON.stringify({
        action: 'generate',
        profile: masterProfile,
        job: {
          id: activeJob?.id || activeJob?.canonicalKey || `manual-${Date.now()}`,
          empresa: activeJob?.empresa || 'Vaga Externa',
          cargo,
          requisitos: activeJob?.requisitos || ''
        },
        jdText
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha na geração do currículo.');

    currentResumeState = {
      id: `cv-${Date.now()}`,
      vaga_id: activeJob?.id || activeJob?.canonicalKey || `manual-${Date.now()}`,
      vaga_empresa: activeJob?.empresa || 'Vaga Externa',
      vaga_cargo: cargo || data.match_report?.target_role || 'Currículo ATS',
      idioma: data.idioma || 'pt-BR',
      jd_snapshot: jdText,
      resume_json: data.resume_json,
      match_report: data.match_report,
      audit_report: data.audit_report,
      created_at: new Date().toISOString()
    };

    renderTransparencyPanel(currentResumeState.match_report, currentResumeState.audit_report);
    renderResumeSheet(currentResumeState.resume_json);
    await saveResumeToHistory(currentResumeState);
    showToast('Currículo ATS gerado e auditado com sucesso!');
  } catch (err) {
    showToast(`Erro: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = currentResumeState ? 'Regerar' : 'Gerar Currículo';
  }
}

function renderTransparencyPanel(matchReport, auditReport) {
  const container = document.getElementById('transparency-content');
  const fitText = document.getElementById('fit-summary-text');
  if (!matchReport) return;

  container.style.display = 'block';
  fitText.textContent = matchReport.fit_summary || 'Análise concluída com base nos fatos verificados.';

  const direct = matchReport.direct_matches || [];
  const gaps = matchReport.excluded_gaps || [];
  const analysisBtn = document.getElementById('btn-open-analysis');
  if (analysisBtn) {
    analysisBtn.textContent = `Análise de Aderência (${direct.length} matches · ${gaps.length} gaps)`;
  }

  document.getElementById('count-direct').textContent = direct.length;
  document.getElementById('list-direct-matches').innerHTML = direct.length
    ? direct.map((m) => `<span class="chip match">${escapeHtml(m)}</span>`).join('')
    : '<span class="field-hint">Nenhum match literal direto.</span>';

  const terms = matchReport.terminological_matches || [];
  document.getElementById('count-term').textContent = terms.length;
  document.getElementById('list-term-matches').innerHTML = terms.length
    ? terms.map((t) => `
        <div class="term-item">
          <strong>${escapeHtml(t.jd_term)}</strong> — ${escapeHtml(t.safe_framing)}
          <div class="field-hint" style="margin-top:0.2rem;">Base: ${escapeHtml(t.candidate_evidence)}</div>
        </div>
      `).join('')
    : '<span class="field-hint">Nenhuma adaptação terminológica aplicada.</span>';

  document.getElementById('count-gaps').textContent = gaps.length;
  document.getElementById('list-excluded-gaps').innerHTML = gaps.length
    ? gaps.map((g) => `<span class="chip gap">${escapeHtml(g)}</span>`).join('')
    : '<span class="field-hint">Nenhum requisito ausente.</span>';

  const auditBox = document.getElementById('audit-summary-box');
  const g = auditReport?.guardrails || {};
  const blockedCount = (g.blocked_skills || []).length;
  const corrCount = (auditReport?.corrections || []).length;
  const bulletsChecked = auditReport?.total_bullets_checked || 0;

  auditBox.innerHTML = `
    <div class="audit-badge-ok">Auditoria: ${bulletsChecked} bullets verificados · Formação preservada · ${blockedCount} skills bloqueadas · ${corrCount} ajustes</div>
  `;
}

let sheetEditMode = true;
let resumeUndoStack = [];

function pushUndoSnapshot() {
  if (!currentResumeState?.resume_json) return;
  resumeUndoStack.push(JSON.stringify(currentResumeState.resume_json));
  if (resumeUndoStack.length > 20) resumeUndoStack.shift();
  const undoBtn = document.getElementById('btn-undo-edit');
  if (undoBtn) undoBtn.style.display = 'inline-flex';
}

function undoResumeEdit() {
  if (!resumeUndoStack.length || !currentResumeState) return;
  const prev = resumeUndoStack.pop();
  currentResumeState.resume_json = JSON.parse(prev);
  renderResumeSheet(currentResumeState.resume_json);
  const undoBtn = document.getElementById('btn-undo-edit');
  if (undoBtn && resumeUndoStack.length === 0) undoBtn.style.display = 'none';
  showToast('Alteração desfeita.');
}

function toggleSheetEditMode() {
  sheetEditMode = !sheetEditMode;
  const sheet = document.getElementById('ats-resume-sheet');
  const btn = document.getElementById('btn-toggle-edit');
  if (sheet) sheet.classList.toggle('edit-mode-on', sheetEditMode);
  if (btn) {
    btn.textContent = sheetEditMode ? 'Preview Limpo' : 'Voltar ao Modo Edição';
  }
  if (!sheetEditMode) {
    syncSheetDomToResumeJson();
    if (currentResumeState) saveResumeToHistory(currentResumeState);
  }
}

/**
 * Sincroniza TODAS as edições feitas diretamente na folha HTML de volta para currentResumeState.resume_json
 */
function syncSheetDomToResumeJson() {
  if (!currentResumeState?.resume_json) return;
  const r = currentResumeState.resume_json;
  r.basics = r.basics || {};

  const getTxt = (id) => (document.getElementById(id)?.innerText || '').trim();
  r.basics.name = getTxt('sheet-name') || r.basics.name;
  r.target_role = getTxt('sheet-role');
  r.basics.location = getTxt('sheet-location');
  r.summary = getTxt('sheet-summary');

  const pe = getTxt('sheet-phone-email');
  if (pe) {
    const parts = pe.split('|').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      r.basics.phone = parts[0];
      r.basics.email = parts[1];
    } else if (parts[0]?.includes('@')) {
      r.basics.email = parts[0];
    } else if (parts[0]) {
      r.basics.phone = parts[0];
    }
  }

  // Experiências
  const expEls = document.querySelectorAll('#sheet-experiences-list .ats-entry');
  r.experiences = Array.from(expEls).map((el, idx) => {
    const orig = (r.experiences || [])[idx] || { id: `exp-edit-${idx}` };
    const role = (el.querySelector('.ats-entry-title')?.innerText || '').trim();
    const meta = (el.querySelector('.ats-entry-meta')?.innerText || '').trim();
    const bullets = Array.from(el.querySelectorAll('.ats-bullet-text'))
      .map((b) => ({ text: b.innerText.trim() }))
      .filter((b) => b.text);
    return { ...orig, role, _custom_meta: meta, bullets };
  });

  // Projetos
  const projEls = document.querySelectorAll('#sheet-projects-list .ats-entry');
  r.projects = Array.from(projEls).map((el, idx) => {
    const orig = (r.projects || [])[idx] || { id: `proj-edit-${idx}` };
    const name = (el.querySelector('.ats-entry-title')?.innerText || '').trim();
    const meta = (el.querySelector('.ats-entry-meta')?.innerText || '').trim();
    const bullets = Array.from(el.querySelectorAll('.ats-bullet-text'))
      .map((b) => ({ text: b.innerText.trim() }))
      .filter((b) => b.text);
    return { ...orig, name, _custom_meta: meta, bullets };
  });

  // Formação
  const eduEls = document.querySelectorAll('#sheet-education-list .ats-entry');
  r.education = Array.from(eduEls).map((el, idx) => {
    const orig = (r.education || [])[idx] || { id: `edu-edit-${idx}` };
    const degreeLine = (el.querySelector('.ats-edu-degree')?.innerText || '').trim();
    const instLine = (el.querySelector('.ats-edu-inst')?.innerText || '').trim();
    return { ...orig, _custom_degree: degreeLine, _custom_inst: instLine };
  });

  // Habilidades
  const skillEls = document.querySelectorAll('#sheet-skills-list .ats-skill-row');
  r.skills_grouped = Array.from(skillEls).map((el) => {
    const cat = (el.querySelector('.ats-skill-cat')?.innerText || '').replace(/:$/, '').trim();
    const itemsRaw = (el.querySelector('.ats-skill-items')?.innerText || '').replace(/\.$/, '').trim();
    const items = itemsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    return { category: cat || 'Habilidades', items };
  }).filter((g) => g.items.length > 0 || g.category);

  // Certificações
  const certEls = document.querySelectorAll('#sheet-certifications-list .ats-bullet-text');
  r.certifications = Array.from(certEls)
    .map((el, idx) => {
      const text = el.innerText.trim();
      const orig = (r.certifications || [])[idx] || {};
      return text ? { ...orig, _custom_line: text, name: orig.name || text } : null;
    })
    .filter(Boolean);

  // Idiomas
  const langTxt = getTxt('sheet-languages-line');
  if (langTxt) {
    r._custom_languages_line = langTxt;
  }
}

function ensureResumeState() {
  if (!currentResumeState) {
    currentResumeState = {
      id: `cv-${Date.now()}`,
      vaga_id: activeJob?.id || activeJob?.canonicalKey || `manual-${Date.now()}`,
      vaga_empresa: activeJob?.empresa || 'Currículo Editável',
      vaga_cargo: document.getElementById('input-job-role')?.value.trim() || activeJob?.cargo || 'Currículo ATS',
      idioma: 'pt-BR',
      jd_snapshot: document.getElementById('input-jd-text')?.value.trim() || '',
      resume_json: {
        idioma: 'pt-BR',
        target_role: document.getElementById('input-job-role')?.value.trim() || masterProfile.basics?.headline || '',
        basics: { ...masterProfile.basics },
        summary: document.getElementById('sheet-summary')?.innerText.trim() || '',
        experiences: [...(masterProfile.experiences || [])],
        projects: [...(masterProfile.projects || []).slice(0, 3)],
        education: [...(masterProfile.education || [])],
        skills_grouped: masterProfile.skills_whitelist?.length
          ? [{ category: 'Habilidades', items: [...masterProfile.skills_whitelist] }]
          : [],
        certifications: [...(masterProfile.certifications || [])],
        languages_spoken: [...(masterProfile.languages_spoken || [])]
      },
      match_report: null,
      audit_report: null,
      created_at: new Date().toISOString()
    };
  }
  return currentResumeState.resume_json;
}

function renderResumeSheet(resume) {
  if (!resume) return;
  const isEn = resume.idioma === 'en';
  const ce = 'contenteditable="true"';

  // Títulos das 7 seções na ordem exata de modelo-cv.docx
  document.getElementById('lbl-summary').textContent = isEn ? 'SUMMARY' : 'RESUMO';
  document.getElementById('lbl-experiences').textContent = isEn ? 'PROFESSIONAL EXPERIENCE' : 'EXPERIÊNCIA PROFISSIONAL';
  document.getElementById('lbl-projects').textContent = isEn ? 'PROJECTS' : 'PROJETOS';
  document.getElementById('lbl-education').textContent = isEn ? 'EDUCATION' : 'FORMAÇÃO';
  document.getElementById('lbl-skills').textContent = isEn ? 'SKILLS' : 'HABILIDADES';
  document.getElementById('lbl-certifications').textContent = isEn ? 'CERTIFICATIONS' : 'CERTIFICAÇÕES';
  document.getElementById('lbl-languages').textContent = isEn ? 'LANGUAGES' : 'IDIOMAS';

  // Cabeçalho 5 linhas à esquerda (padrão modelo-cv.docx)
  const b = resume.basics || {};
  document.getElementById('sheet-name').textContent = b.name || 'Seu Nome';
  const roleEl = document.getElementById('sheet-role');
  if (roleEl) roleEl.textContent = resume.target_role || b.headline || '';

  const locEl = document.getElementById('sheet-location');
  if (locEl) {
    locEl.textContent = b.location || '';
    locEl.style.display = b.location ? 'block' : 'none';
  }

  const phoneEmailEl = document.getElementById('sheet-phone-email');
  if (phoneEmailEl) {
    const pe = [b.phone, b.email].filter(Boolean).join(' | ');
    phoneEmailEl.textContent = pe;
    phoneEmailEl.style.display = pe ? 'block' : 'none';
  }

  const linksEl = document.getElementById('sheet-links');
  if (linksEl) {
    const cleanUrl = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '');
    const linksParts = [];
    if (b.linkedin) linksParts.push(`LinkedIn: ${cleanUrl(b.linkedin)}`);
    if (b.github) linksParts.push(`GitHub: ${cleanUrl(b.github)}`);
    if (b.portfolio) linksParts.push(`Portfólio: ${cleanUrl(b.portfolio)}`);
    linksEl.textContent = linksParts.join(' | ');
    linksEl.style.display = linksParts.length ? 'block' : 'none';
  }

  // 1. RESUMO
  document.getElementById('sheet-summary').textContent = resume.summary || '';

  // 2. EXPERIÊNCIA PROFISSIONAL
  const expList = resume.experiences || [];
  document.getElementById('sheet-sec-experiences').style.display = expList.length ? 'block' : 'none';
  document.getElementById('sheet-experiences-list').innerHTML = expList.map((exp, idx) => {
    const period = [exp.start_date, exp.end_date].filter(Boolean).join(' - ');
    const meta = exp._custom_meta !== undefined ? exp._custom_meta : [exp.company, exp.location, period].filter(Boolean).join(' · ');
    return `
      <div class="ats-entry">
        <div class="ats-entry-top">
          <span class="ats-entry-title" ${ce}>${escapeHtml(exp.role || exp.company)}</span>
          <span class="ats-entry-actions">
            ${idx > 0 ? `<button type="button" class="sheet-edit-ctrl" title="Subir" onclick="sheetMoveItem('experiences', ${idx}, -1)">↑</button>` : ''}
            ${idx < expList.length - 1 ? `<button type="button" class="sheet-edit-ctrl" title="Descer" onclick="sheetMoveItem('experiences', ${idx}, 1)">↓</button>` : ''}
            <button type="button" class="sheet-edit-ctrl" title="Adicionar bullet" onclick="sheetAddBullet('experiences', ${idx})">+ Bullet</button>
            <button type="button" class="sheet-edit-ctrl del" title="Remover experiência" onclick="sheetRemoveItem('experiences', ${idx})">×</button>
          </span>
        </div>
        <span class="ats-entry-meta" ${ce}>${escapeHtml(meta)}</span>
        <ul class="ats-bullets">
          ${(exp.bullets || []).map((bul, bIdx) => `
            <li>
              <div class="ats-bullet-row">
                <span class="ats-bullet-text" ${ce}>${escapeHtml(bul.text || bul)}</span>
                <button type="button" class="sheet-edit-ctrl del ats-bullet-del" title="Remover bullet" onclick="sheetRemoveBullet('experiences', ${idx}, ${bIdx})">×</button>
              </div>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }).join('');

  // 3. PROJETOS
  const projList = resume.projects || [];
  document.getElementById('sheet-sec-projects').style.display = 'block';
  document.getElementById('sheet-projects-list').innerHTML = projList.map((proj, idx) => {
    const cleanRepo = proj.url ? proj.url.replace(/^https?:\/\/(www\.)?/, '') : '';
    const stackLine = (proj.tech_stack || []).length ? proj.tech_stack.join(', ') : '';
    const meta = proj._custom_meta !== undefined ? proj._custom_meta : [cleanRepo, stackLine].filter(Boolean).join(' · ');
    return `
      <div class="ats-entry">
        <div class="ats-entry-top">
          <span class="ats-entry-title" ${ce}>${escapeHtml(proj.name)}</span>
          <span class="ats-entry-actions">
            ${idx > 0 ? `<button type="button" class="sheet-edit-ctrl" title="Subir" onclick="sheetMoveItem('projects', ${idx}, -1)">↑</button>` : ''}
            ${idx < projList.length - 1 ? `<button type="button" class="sheet-edit-ctrl" title="Descer" onclick="sheetMoveItem('projects', ${idx}, 1)">↓</button>` : ''}
            <button type="button" class="sheet-edit-ctrl" title="Adicionar bullet" onclick="sheetAddBullet('projects', ${idx})">+ Bullet</button>
            <button type="button" class="sheet-edit-ctrl del" title="Remover projeto" onclick="sheetRemoveItem('projects', ${idx})">×</button>
          </span>
        </div>
        <span class="ats-entry-meta" ${ce}>${escapeHtml(meta)}</span>
        <ul class="ats-bullets">
          ${(proj.bullets || []).map((bul, bIdx) => `
            <li>
              <div class="ats-bullet-row">
                <span class="ats-bullet-text" ${ce}>${escapeHtml(bul.text || bul)}</span>
                <button type="button" class="sheet-edit-ctrl del ats-bullet-del" title="Remover bullet" onclick="sheetRemoveBullet('projects', ${idx}, ${bIdx})">×</button>
              </div>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }).join('');

  // 4. FORMAÇÃO
  const eduList = resume.education || [];
  document.getElementById('sheet-sec-education').style.display = eduList.length ? 'block' : 'none';
  document.getElementById('sheet-education-list').innerHTML = eduList.map((edu, idx) => {
    const degreeTitle = edu._custom_degree !== undefined ? edu._custom_degree : [edu.degree, edu.field].filter(Boolean).join(' — ');
    const period = [edu.start_date, edu.end_date].filter(Boolean).join(' - ');
    const instLine = edu._custom_inst !== undefined ? edu._custom_inst : [edu.institution, period].filter(Boolean).join(' · ');
    return `
      <div class="ats-entry">
        <div class="ats-entry-top">
          <span class="ats-edu-degree" ${ce}>${escapeHtml(degreeTitle || edu.institution)}</span>
          <span class="ats-entry-actions">
            <button type="button" class="sheet-edit-ctrl del" title="Remover formação" onclick="sheetRemoveItem('education', ${idx})">×</button>
          </span>
        </div>
        <span class="ats-edu-inst" ${ce}>${escapeHtml(instLine)}</span>
      </div>
    `;
  }).join('');

  // 5. HABILIDADES
  const skills = resume.skills_grouped || [];
  document.getElementById('sheet-sec-skills').style.display = skills.length ? 'block' : 'none';
  document.getElementById('sheet-skills-list').innerHTML = skills.map((g, idx) => {
    const itemsStr = (g.items || []).join(', ');
    const withDot = itemsStr && !itemsStr.endsWith('.') ? `${itemsStr}.` : itemsStr;
    return `
      <div class="ats-skill-row">
        <div style="flex:1;">
          <strong class="ats-skill-cat" ${ce}>${escapeHtml(g.category)}:</strong>
          <span class="ats-skill-items" ${ce}> ${escapeHtml(withDot)}</span>
        </div>
        <button type="button" class="sheet-edit-ctrl del ats-bullet-del" title="Remover categoria" onclick="sheetRemoveItem('skills_grouped', ${idx})">×</button>
      </div>
    `;
  }).join('');

  // 6. CERTIFICAÇÕES
  const certs = resume.certifications || [];
  const certSec = document.getElementById('sheet-sec-certifications');
  const certListEl = document.getElementById('sheet-certifications-list');
  if (certSec && certListEl) {
    certSec.style.display = certs.length ? 'block' : 'none';
    certListEl.innerHTML = certs.map((c, idx) => {
      const meta = [c.authority, c.date].filter(Boolean).join(', ');
      const line = c._custom_line || (meta ? `${c.name} (${meta}).` : `${c.name}.`);
      return `
        <li>
          <div class="ats-bullet-row">
            <span class="ats-bullet-text" ${ce}>${escapeHtml(line)}</span>
            <button type="button" class="sheet-edit-ctrl del ats-bullet-del" title="Remover certificado" onclick="sheetRemoveItem('certifications', ${idx})">×</button>
          </div>
        </li>
      `;
    }).join('');
  }

  // 7. IDIOMAS
  const langs = resume.languages_spoken || [];
  const langSec = document.getElementById('sheet-sec-languages');
  const langLineEl = document.getElementById('sheet-languages-line');
  if (langSec && langLineEl) {
    const line = resume._custom_languages_line || langs
      .map((l) => (l.proficiency ? `${l.name}: ${l.proficiency}.` : `${l.name}.`))
      .join(' ');
    langSec.style.display = line ? 'block' : 'none';
    langLineEl.textContent = line;
  }
}

/* =============================================================
   AÇÕES INTERATIVAS DE EDIÇÃO DIRETA NA FOLHA
   ============================================================= */
function sheetAddBullet(section, itemIdx) {
  syncSheetDomToResumeJson();
  const r = ensureResumeState();
  pushUndoSnapshot();
  r[section][itemIdx].bullets = r[section][itemIdx].bullets || [];
  r[section][itemIdx].bullets.push({ text: 'Descreva aqui uma entrega real ou resultado obtido.' });
  renderResumeSheet(r);
  const containerId = section === 'projects' ? 'sheet-projects-list' : 'sheet-experiences-list';
  const entry = document.querySelectorAll(`#${containerId} .ats-entry`)[itemIdx];
  const bullets = entry?.querySelectorAll('.ats-bullet-text');
  bullets?.[bullets.length - 1]?.focus();
}

function sheetRemoveBullet(section, itemIdx, bulletIdx) {
  syncSheetDomToResumeJson();
  const r = ensureResumeState();
  pushUndoSnapshot();
  r[section][itemIdx].bullets.splice(bulletIdx, 1);
  renderResumeSheet(r);
}

function sheetRemoveItem(section, itemIdx) {
  syncSheetDomToResumeJson();
  const r = ensureResumeState();
  pushUndoSnapshot();
  r[section].splice(itemIdx, 1);
  renderResumeSheet(r);
}

function sheetMoveItem(section, idx, delta) {
  syncSheetDomToResumeJson();
  const r = ensureResumeState();
  const target = idx + delta;
  if (target < 0 || target >= r[section].length) return;
  pushUndoSnapshot();
  const tmp = r[section][idx];
  r[section][idx] = r[section][target];
  r[section][target] = tmp;
  renderResumeSheet(r);
}

function toggleAddProjectFromBank() {
  const box = document.getElementById('sheet-project-bank-picker');
  if (!box) return;
  if (box.style.display !== 'none') {
    box.style.display = 'none';
    return;
  }
  syncSheetDomToResumeJson();
  const r = ensureResumeState();
  const alreadyIds = new Set((r.projects || []).map((p) => p.id));
  const available = (masterProfile.projects || []).filter((p) => !alreadyIds.has(p.id));

  if (available.length === 0) {
    box.innerHTML = '<span>Todos os projetos do seu Banco de Fatos já estão no currículo (ou importe mais no Passo 2).</span> <button type="button" class="sheet-edit-ctrl" onclick="toggleAddProjectFromBank()">Fechar</button>';
  } else {
    box.innerHTML = `
      <strong>Adicionar projeto verificado:</strong>
      ${available.map((p) => `<button type="button" class="sheet-edit-ctrl" onclick="sheetInsertProjectFromBank('${escapeHtml(p.id)}')">+ ${escapeHtml(p.name)}</button>`).join('')}
      <button type="button" class="sheet-edit-ctrl del" onclick="toggleAddProjectFromBank()">Fechar</button>
    `;
  }
  box.style.display = 'flex';
}

function sheetInsertProjectFromBank(projId) {
  syncSheetDomToResumeJson();
  const r = ensureResumeState();
  const src = (masterProfile.projects || []).find((p) => p.id === projId);
  if (!src) return;
  pushUndoSnapshot();
  r.projects = r.projects || [];
  r.projects.push({
    id: src.id,
    name: src.name,
    url: src.url || '',
    tech_stack: src.verified_skills || src.languages || [],
    bullets: (src.facts && src.facts.length > 0 ? src.facts.slice(0, 3) : [src.readme_summary || 'Descrição do projeto.'])
      .map((t) => ({ text: t }))
  });
  document.getElementById('sheet-project-bank-picker').style.display = 'none';
  renderResumeSheet(r);
  showToast(`Projeto "${src.name}" adicionado ao currículo!`);
}

function sheetAddBlankProject() {
  syncSheetDomToResumeJson();
  const r = ensureResumeState();
  pushUndoSnapshot();
  r.projects = r.projects || [];
  r.projects.push({
    id: `custom-proj-${Date.now()}`,
    name: 'Nome do Projeto',
    url: '',
    tech_stack: [],
    _custom_meta: 'github.com/usuario/repo · Tecnologias',
    bullets: [{ text: 'Descreva o que foi construído e qual problema resolveu.' }]
  });
  renderResumeSheet(r);
}

function sheetAddExperience() {
  syncSheetDomToResumeJson();
  const r = ensureResumeState();
  pushUndoSnapshot();
  r.experiences = r.experiences || [];
  r.experiences.push({
    id: `custom-exp-${Date.now()}`,
    role: 'Cargo / Função',
    company: 'Empresa',
    _custom_meta: 'Empresa · Cidade, UF · Mês/Ano - Atual',
    bullets: [{ text: 'Descreva sua principal entrega ou responsabilidade real.' }]
  });
  renderResumeSheet(r);
}

function sheetAddEducation() {
  syncSheetDomToResumeJson();
  const r = ensureResumeState();
  pushUndoSnapshot();
  r.education = r.education || [];
  r.education.push({
    id: `custom-edu-${Date.now()}`,
    _custom_degree: 'Curso / Formação',
    _custom_inst: 'Instituição · Ano início - Previsão de conclusão'
  });
  renderResumeSheet(r);
}

function sheetAddSkillCategory() {
  syncSheetDomToResumeJson();
  const r = ensureResumeState();
  pushUndoSnapshot();
  r.skills_grouped = r.skills_grouped || [];
  r.skills_grouped.push({ category: 'Nova Categoria', items: ['Tecnologia 1', 'Tecnologia 2'] });
  renderResumeSheet(r);
}

function sheetAddCertification() {
  syncSheetDomToResumeJson();
  const r = ensureResumeState();
  pushUndoSnapshot();
  r.certifications = r.certifications || [];
  r.certifications.push({
    id: `custom-cert-${Date.now()}`,
    _custom_line: 'Nome do Certificado (Instituição, Ano).'
  });
  renderResumeSheet(r);
}

/* =============================================================
   HISTÓRICO, EDIÇÃO INLINE & EXPORTAÇÃO PDF ATS
   ============================================================= */
function getLocalHistory() {
  try {
    return JSON.parse(localStorage.getItem(getStudioStorageKeys().HISTORY) || '[]');
  } catch {
    return [];
  }
}

async function saveResumeToHistory(record) {
  const hist = getLocalHistory().filter((h) => h.id !== record.id);
  hist.unshift(record);
  localStorage.setItem(getStudioStorageKeys().HISTORY, JSON.stringify(hist.slice(0, 25)));
  renderHistoryList();

  if (supabaseClient && currentUser) {
    const payload = {
      user_id: currentUser.id,
      vaga_id: record.vaga_id,
      vaga_empresa: record.vaga_empresa,
      vaga_cargo: record.vaga_cargo,
      idioma: record.idioma,
      jd_snapshot: record.jd_snapshot || '',
      match_report: record.match_report || {},
      resume_json: record.resume_json || {},
      audit_report: record.audit_report || {}
    };
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(record.id || ''));
    const cloudId = record._cloud_id || (isUuid ? record.id : null);
    if (cloudId) {
      await supabaseClient
        .from('curriculos_gerados')
        .update(payload)
        .eq('id', cloudId)
        .eq('user_id', currentUser.id);
    } else {
      const { data } = await supabaseClient
        .from('curriculos_gerados')
        .insert(payload)
        .select('id')
        .maybeSingle();
      if (data?.id) {
        record._cloud_id = data.id;
        localStorage.setItem(getStudioStorageKeys().HISTORY, JSON.stringify(hist.slice(0, 25)));
      }
    }
  }
}

function renderHistoryList() {
  const listEl = document.getElementById('resume-history-list');
  const hist = getLocalHistory();
  if (!hist.length) {
    listEl.innerHTML = '<p class="field-hint">Nenhum currículo gerado ainda.</p>';
    return;
  }
  listEl.innerHTML = hist.slice(0, 8).map((item, idx) => {
    const dt = item.created_at ? new Date(item.created_at).toLocaleDateString('pt-BR') : '';
    return `
      <div class="history-item" onclick="loadHistoryItem(${idx})">
        <div>
          <strong>${escapeHtml(item.vaga_empresa)}</strong> — ${escapeHtml(item.vaga_cargo)}
          <div class="field-hint">${dt} · ${escapeHtml(item.idioma)}</div>
        </div>
        <span>↗</span>
      </div>
    `;
  }).join('');
}

function loadHistoryItem(idx) {
  const hist = getLocalHistory();
  const item = hist[idx];
  if (!item) return;
  resumeUndoStack = [];
  const undoBtn = document.getElementById('btn-undo-edit');
  if (undoBtn) undoBtn.style.display = 'none';
  currentResumeState = item;
  renderTransparencyPanel(item.match_report, item.audit_report);
  renderResumeSheet(item.resume_json);
  showToast(`Versão carregada: ${item.vaga_empresa}`);
}

function saveCurrentResumeEdits() {
  ensureResumeState();
  syncSheetDomToResumeJson();
  saveResumeToHistory(currentResumeState);
  showToast('Todas as edições do currículo foram salvas!');
}

function copyResumePlainText() {
  const sheet = document.getElementById('ats-resume-sheet');
  if (!sheet) return;
  // Clona e remove controles de edição antes de copiar o texto limpo
  const clone = sheet.cloneNode(true);
  clone.querySelectorAll('.sheet-edit-ctrl, .ats-entry-actions, .ats-swap-box').forEach((el) => el.remove());
  const cleanText = clone.innerText.replace(/\n{3,}/g, '\n\n').trim();
  navigator.clipboard.writeText(cleanText).then(() => {
    showToast('Texto limpo do currículo copiado para a área de transferência!');
  });
}

function exportATSPdf() {
  if (currentResumeState) {
    syncSheetDomToResumeJson();
    saveResumeToHistory(currentResumeState);
  }
  window.print();
}

document.addEventListener('DOMContentLoaded', () => {
  initStudio();
  const sheet = document.getElementById('ats-resume-sheet');
  if (sheet) {
    let autoSaveTimer = null;
    sheet.addEventListener('input', () => {
      if (!currentResumeState) return;
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        syncSheetDomToResumeJson();
        saveResumeToHistory(currentResumeState);
      }, 600);
    });
  }
});
