require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados no .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const HISTORICO_PATH = path.join(__dirname, '..', 'historico_execucoes.js');

async function migrar() {
  if (!fs.existsSync(HISTORICO_PATH)) {
    console.error('❌ Arquivo historico_execucoes.js não encontrado');
    process.exit(1);
  }

  const raw = fs.readFileSync(HISTORICO_PATH, 'utf8');
  const startIdx = raw.indexOf('[');
  const endIdx = raw.lastIndexOf(']');
  if (startIdx === -1 || endIdx === -1) {
    console.error('❌ Não foi possível extrair o array JSON de historico_execucoes.js');
    process.exit(1);
  }

  const historico = JSON.parse(raw.substring(startIdx, endIdx + 1));
  console.log(`📦 Carregados ${historico.length} registros de execução.`);

  // Inverter para inserir em ordem cronológica (antigos primeiro)
  const cronologico = historico.slice().reverse();

  const payload = cronologico.map(h => ({
    timestamp: h.timestamp,
    status: h.status,
    is_erro: !!h.isErro,
    duracao_segundos: h.duracaoSegundos || 0,
    mensagem: h.mensagem || '',
    total_vagas: Array.isArray(h.vagas) ? h.vagas.length : 0
  }));

  const BATCH_SIZE = 50;
  let inseridos = 0;

  for (let i = 0; i < payload.length; i += BATCH_SIZE) {
    const lote = payload.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('historico_execucoes').insert(lote);

    if (error) {
      console.error(`❌ Erro no lote ${i} a ${i + lote.length}:`, error.message);
      process.exit(1);
    }

    inseridos += lote.length;
    console.log(`   ✅ Sincronizados ${inseridos}/${payload.length} registros de telemetria...`);
  }

  console.log('\n🎉 Migração do histórico concluída com sucesso!');
  const { count } = await supabase.from('historico_execucoes').select('*', { count: 'exact', head: true });
  console.log(`📊 Total de registros de execução no Supabase: ${count}`);
}

migrar();
