/* =============================================================
   SONA AUTH GUARD & USER ISOLATION HELPERS (auth_guard.js)
   Compatível com Browser (window.SonaAuth) e Node.js (CommonJS)
   ============================================================= */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.SonaAuth = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const LEGACY_STORAGE_KEYS = {
    USER_STORE: 'estagios_user_store',
    PARAMS: 'estagios_crawler_params',
    PROFILE: 'sona_master_profile_v1',
    HISTORY: 'sona_resume_history_v1',
    BYOK: 'sona_byok_config_v1'
  };

  let _client = null;
  let _session = null;
  let _user = null;
  let _authListenerAttached = false;

  function sanitizeNextPath(rawNext, fallback = '/dashboard.html') {
    if (!rawNext || typeof rawNext !== 'string') return fallback;
    const trimmed = rawNext.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('://')) {
      return fallback;
    }
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('/auth.html') || lower.startsWith('javascript:')) {
      return fallback;
    }
    return trimmed;
  }

  function getUserScopedKeys(userId) {
    const uid = String(userId || 'anon').trim() || 'anon';
    return {
      USER_STORE: `sona_user_store_${uid}`,
      PARAMS: `sona_params_${uid}`,
      PENDING_SYNC: `sona_pending_sync_${uid}`,
      PROFILE: `sona_profile_${uid}`,
      HISTORY: `sona_history_${uid}`,
      BYOK_KEY: `sona_byok_key_${uid}`,
      ACTIVE_JOB: `sona_active_job_${uid}`
    };
  }

  function isNeutralVagaEntry(entry) {
    if (!entry || typeof entry !== 'object') return true;
    const status = entry.status || 'para_aplicar';
    return (
      status === 'para_aplicar' &&
      !entry.starred &&
      !entry.etapaConcluida &&
      !entry.candidaturaExterna &&
      !entry.motivoMismatch &&
      !entry.dataAplicacao &&
      !entry.inicioCandidatura
    );
  }

  function storeEntryToDbRow(userId, vagaKey, entry, vagaId = null) {
    const safe = entry || {};
    const metadata = {};
    if (safe.detalhesAcao) metadata.detalhesAcao = safe.detalhesAcao;
    if (safe.dataConclusaoEtapa) metadata.dataConclusaoEtapa = safe.dataConclusaoEtapa;
    if (safe.ultimoAssuntoConcluido) metadata.ultimoAssuntoConcluido = safe.ultimoAssuntoConcluido;
    if (safe.ultimaDataRecebimentoConcluida) {
      metadata.ultimaDataRecebimentoConcluida = safe.ultimaDataRecebimentoConcluida;
    }
    if (safe.motivoEncerramento) metadata.motivoEncerramento = safe.motivoEncerramento;

    return {
      user_id: userId,
      vaga_key: vagaKey,
      vaga_id: vagaId || safe.vagaId || null,
      status: safe.status || 'para_aplicar',
      starred: Boolean(safe.starred),
      etapa_concluida: Boolean(safe.etapaConcluida),
      candidatura_externa: Boolean(safe.candidaturaExterna),
      data_aplicacao: safe.dataAplicacao || null,
      inicio_candidatura: typeof safe.inicioCandidatura === 'number' ? safe.inicioCandidatura : null,
      tempo_gasto_segundos: typeof safe.tempoGastoSegundos === 'number' ? safe.tempoGastoSegundos : null,
      motivo_mismatch: safe.motivoMismatch || '',
      detalhe_mismatch: safe.detalheMismatch || '',
      data_mismatch: safe.dataMismatch || null,
      metadata
    };
  }

  function dbRowToStoreEntry(row) {
    const meta = (row && typeof row.metadata === 'object' && row.metadata) || {};
    const entry = {
      status: row.status || 'para_aplicar',
      starred: Boolean(row.starred),
      etapaConcluida: Boolean(row.etapa_concluida),
      candidaturaExterna: Boolean(row.candidatura_externa)
    };
    if (row.vaga_id) entry.vagaId = row.vaga_id;
    if (row.data_aplicacao) entry.dataAplicacao = row.data_aplicacao;
    if (typeof row.inicio_candidatura === 'number') entry.inicioCandidatura = row.inicio_candidatura;
    if (typeof row.tempo_gasto_segundos === 'number') entry.tempoGastoSegundos = row.tempo_gasto_segundos;
    if (row.motivo_mismatch) entry.motivoMismatch = row.motivo_mismatch;
    if (row.detalhe_mismatch) entry.detalheMismatch = row.detalhe_mismatch;
    if (row.data_mismatch) entry.dataMismatch = row.data_mismatch;
    if (meta.detalhesAcao) entry.detalhesAcao = meta.detalhesAcao;
    if (meta.dataConclusaoEtapa) entry.dataConclusaoEtapa = meta.dataConclusaoEtapa;
    if (meta.ultimoAssuntoConcluido) entry.ultimoAssuntoConcluido = meta.ultimoAssuntoConcluido;
    if (meta.ultimaDataRecebimentoConcluida) {
      entry.ultimaDataRecebimentoConcluida = meta.ultimaDataRecebimentoConcluida;
    }
    if (meta.motivoEncerramento) entry.motivoEncerramento = meta.motivoEncerramento;

    return { vagaKey: row.vaga_key, entry };
  }

  function computeInitials(nameOrEmail) {
    const clean = String(nameOrEmail || '').trim();
    if (!clean) return 'US';
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }

  function deriveUserIdentity(user, settings = null) {
    const u = user || {};
    const meta = u.user_metadata || {};
    const appMeta = u.app_metadata || {};
    const cfg = settings || {};
    const email = u.email || '';
    const emailPrefix = email.split('@')[0] || 'usuario';

    const displayName =
      (cfg.display_name && cfg.display_name.trim()) ||
      (meta.full_name && String(meta.full_name).trim()) ||
      (meta.name && String(meta.name).trim()) ||
      emailPrefix;

    let rawHandle =
      (cfg.handle && cfg.handle.trim()) ||
      (meta.user_name && String(meta.user_name).trim()) ||
      emailPrefix.toLowerCase().replace(/[^a-z0-9_.-]/g, '') ||
      'usuario';
    if (!rawHandle.startsWith('@')) rawHandle = `@${rawHandle}`;

    const avatarUrl = (cfg.avatar_url && cfg.avatar_url.trim()) || meta.avatar_url || '';
    const provider = appMeta.provider || (Array.isArray(appMeta.providers) && appMeta.providers[0]) || 'email';
    const dailyGoalNum = Number(cfg.daily_goal);
    const dailyGoal = Number.isFinite(dailyGoalNum) && dailyGoalNum >= 1 && dailyGoalNum <= 50 ? dailyGoalNum : 3;

    return {
      displayName,
      handle: rawHandle,
      email,
      initials: computeInitials(displayName),
      avatarUrl,
      provider,
      dailyGoal
    };
  }

  function translateAuthError(errOrMessage) {
    const raw = String((errOrMessage && errOrMessage.message) || errOrMessage || '').trim();
    const low = raw.toLowerCase();
    if (!raw) return 'Não foi possível concluir a operação. Tente novamente.';
    if (low.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
    if (low.includes('email not confirmed')) return 'Confirme seu e-mail através do link enviado antes de entrar.';
    if (low.includes('user already registered') || low.includes('already been registered')) {
      return 'Este e-mail já possui cadastro. Use a aba Entrar ou recupere sua senha.';
    }
    if (low.includes('password should be at least')) return 'A senha deve ter pelo menos 8 caracteres.';
    if (low.includes('rate limit') || low.includes('over_email_send_rate_limit')) {
      return 'Muitas tentativas seguidas. Aguarde alguns instantes antes de tentar novamente.';
    }
    if (low.includes('same password') || low.includes('different from the old password')) {
      return 'A nova senha deve ser diferente da senha atual.';
    }
    return raw;
  }

  function detectLegacyLocalData(storage) {
    const st = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const counts = { vagas: 0, hasParams: false, hasProfile: false, history: 0, hasByokKey: false };
    if (!st) return { hasLegacy: false, counts };

    try {
      const rawStore = st.getItem(LEGACY_STORAGE_KEYS.USER_STORE);
      if (rawStore) {
        const parsed = JSON.parse(rawStore);
        counts.vagas = Object.keys(parsed || {}).filter((k) => !isNeutralVagaEntry(parsed[k])).length;
      }
    } catch (_) {}

    try {
      counts.hasParams = Boolean(st.getItem(LEGACY_STORAGE_KEYS.PARAMS));
    } catch (_) {}

    try {
      const rawProf = st.getItem(LEGACY_STORAGE_KEYS.PROFILE);
      if (rawProf) {
        const prof = JSON.parse(rawProf);
        counts.hasProfile = Boolean(
          (prof.basics && prof.basics.name) ||
            (Array.isArray(prof.projects) && prof.projects.length > 0) ||
            (Array.isArray(prof.experiences) && prof.experiences.length > 0)
        );
      }
    } catch (_) {}

    try {
      const rawHist = st.getItem(LEGACY_STORAGE_KEYS.HISTORY);
      if (rawHist) {
        const arr = JSON.parse(rawHist);
        counts.history = Array.isArray(arr) ? arr.length : 0;
      }
    } catch (_) {}

    try {
      const rawByok = st.getItem(LEGACY_STORAGE_KEYS.BYOK);
      if (rawByok) {
        const cfg = JSON.parse(rawByok);
        counts.hasByokKey = Boolean(cfg && cfg.apiKey);
      }
    } catch (_) {}

    const hasLegacy =
      counts.vagas > 0 || counts.hasParams || counts.hasProfile || counts.history > 0 || counts.hasByokKey;
    return { hasLegacy, counts };
  }

  function getClient() {
    if (_client) return _client;
    if (typeof window === 'undefined') return null;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
    if (!window.SUPABASE_CONFIG || !window.SUPABASE_CONFIG.url || !window.SUPABASE_CONFIG.anonKey) return null;

    _client = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    return _client;
  }

  function redirectToAuth(customUrl) {
    if (typeof window === 'undefined') return;
    const currentPath = window.location.pathname + window.location.search;
    const nextParam = encodeURIComponent(sanitizeNextPath(currentPath, '/dashboard.html'));
    const target = customUrl || `/auth.html?next=${nextParam}`;
    try {
      if (window.top && window.top !== window) {
        window.top.location.replace(target);
        return;
      }
    } catch (_) {}
    window.location.replace(target);
  }

  async function requireSession(options = {}) {
    const client = getClient();
    if (!client) {
      redirectToAuth('/auth.html?error=config');
      return null;
    }

    const { data, error } = await client.auth.getSession();
    if (error || !data || !data.session || !data.session.user) {
      redirectToAuth();
      return null;
    }

    _session = data.session;
    _user = data.session.user;

    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove('auth-pending');
    }

    if (!_authListenerAttached) {
      _authListenerAttached = true;
      client.auth.onAuthStateChange((event, newSession) => {
        _session = newSession || null;
        _user = newSession?.user || null;
        if (event === 'SIGNED_OUT' || !newSession) {
          redirectToAuth('/auth.html');
          return;
        }
        if (typeof options.onSessionUpdate === 'function') {
          options.onSessionUpdate(newSession);
        }
      });
    }

    return _session;
  }

  async function getAccessToken() {
    const client = getClient();
    if (!client) return '';
    const { data } = await client.auth.getSession();
    return data?.session?.access_token || _session?.access_token || '';
  }

  async function signOut(redirectUrl = '/auth.html') {
    const client = getClient();
    _session = null;
    _user = null;
    if (client) {
      try {
        await client.auth.signOut();
      } catch (_) {}
    }
    redirectToAuth(redirectUrl);
  }

  function clearUserLocalCache(userId, storage) {
    const st = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!st || !userId) return;
    const keys = getUserScopedKeys(userId);
    Object.values(keys).forEach((k) => {
      try {
        st.removeItem(k);
      } catch (_) {}
    });
  }

  return {
    LEGACY_STORAGE_KEYS,
    sanitizeNextPath,
    getUserScopedKeys,
    isNeutralVagaEntry,
    storeEntryToDbRow,
    dbRowToStoreEntry,
    deriveUserIdentity,
    translateAuthError,
    detectLegacyLocalData,
    clearUserLocalCache,
    getClient,
    requireSession,
    getAccessToken,
    signOut,
    get session() {
      return _session;
    },
    get user() {
      return _user;
    }
  };
});
