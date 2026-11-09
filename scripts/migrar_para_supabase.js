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
const BANCO_PATH = path.join(__dirname, '..', 'banco_vagas.json');

async function migrar() {
  if (!fs.existsSync(BANCO_PATH)) {
    console.error('❌ Arquivo banco_vagas.json não encontrado');
    process.exit(1);
  }

  const vagas = JSON.parse(fs.readFileSync(BANCO_PATH, 'utf8'));
  console.log(`📦 Carregadas ${vagas.length} vagas de banco_vagas.json.`);

  // Mapear para o formato do banco do Supabase
  const vagasParaInserir = vagas.map(v => ({
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

  const BATCH_SIZE = 100;
  let inseridas = 0;

  for (let i = 0; i < vagasParaInserir.length; i += BATCH_SIZE) {
    const lote = vagasParaInserir.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('vagas').upsert(lote, { onConflict: 'link' });

    if (error) {
      console.error(`❌ Erro no lote ${i} a ${i + lote.length}:`, error.message);
      process.exit(1);
    }

    inseridas += lote.length;
    console.log(`   ✅ Sincronizadas ${inseridas}/${vagasParaInserir.length} vagas...`);
  }

  console.log('\n🎉 Migração concluída com sucesso!');
  const { count } = await supabase.from('vagas').select('*', { count: 'exact', head: true });
  console.log(`📊 Total de vagas confirmadas no Supabase: ${count}`);
}

migrar();
