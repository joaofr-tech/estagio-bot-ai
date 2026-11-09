require('dotenv').config();
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';

const content = `// Configuração pública do Supabase para o Dashboard (ANON KEY segura para frontend)
window.SUPABASE_CONFIG = {
  url: ${JSON.stringify(url)},
  anonKey: ${JSON.stringify(anonKey)}
};
`;

fs.writeFileSync(path.join(__dirname, '..', 'supabase_config.js'), content, 'utf8');
console.log('✅ supabase_config.js gerado com sucesso!');
