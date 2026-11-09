require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  } catch (err) {
    console.warn('[Supabase] Aviso: Falha ao inicializar cliente Supabase:', err.message);
  }
}

async function upsertVagasSupabase(vagas) {
  if (!supabase || !Array.isArray(vagas) || vagas.length === 0) return false;

  const payload = vagas.map(v => ({
    id: v.id,
    empresa: v.empresa || '',
    cargo: v.cargo || '',
    modalidade: v.modalidade || null,
    localizacao: v.localizacao || null,
    turno: v.turno || null,
    prazo: v.prazo || null,
    requisitos: v.requisitos || null,
    link: v.link,
    data_coleta: v.dataColeta || v.data_coleta || null,
    notificada: typeof v.notificada === 'boolean' ? v.notificada : false,
    status: v.status || 'para_aplicar'
  }));

  try {
    const { error } = await supabase.from('vagas').upsert(payload, { onConflict: 'link' });
    if (error) {
      console.error('[Supabase] Erro ao sincronizar vagas:', error.message);
      return false;
    }
    console.log(`[Supabase] ☁️ ${payload.length} vaga(s) sincronizada(s) com sucesso na nuvem!`);
    return true;
  } catch (err) {
    console.error('[Supabase] Erro de rede/conexão:', err.message);
    return false;
  }
}

module.exports = {
  supabase,
  upsertVagasSupabase
};
