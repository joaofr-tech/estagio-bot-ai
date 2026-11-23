const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const outDir = path.join(rootDir, 'public');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Mantém index.html sempre idêntico a dashboard.html
const dashboardSrc = path.join(rootDir, 'dashboard.html');
const indexDest = path.join(rootDir, 'index.html');
if (fs.existsSync(dashboardSrc)) {
  fs.copyFileSync(dashboardSrc, indexDest);
}

const filesToCopy = [
  'index.html',
  'dashboard.html',
  'auth.html',
  'auth.css',
  'auth_guard.js',
  'design-system.css',
  'curriculo.html',
  'curriculo.css',
  'curriculo.js',
  'banco_vagas.js',
  'config_busca.js',
  'historico_execucoes.js',
  'regras_mismatch.js',
  'supabase_config.js',
  'favicon.svg'
];

filesToCopy.forEach(file => {
  const src = path.join(rootDir, file);
  const dest = path.join(outDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`✓ Copiado: ${file}`);
  }
});

const assetsSrc = path.join(rootDir, 'assets');
const assetsDest = path.join(outDir, 'assets');
if (fs.existsSync(assetsSrc)) {
  if (!fs.existsSync(assetsDest)) {
    fs.mkdirSync(assetsDest, { recursive: true });
  }
  fs.readdirSync(assetsSrc).forEach(file => {
    const s = path.join(assetsSrc, file);
    const d = path.join(assetsDest, file);
    if (fs.statSync(s).isFile()) {
      fs.copyFileSync(s, d);
    }
  });
  console.log('✓ Pasta assets copiada com sucesso');
}

console.log('🎉 Build estático concluído em /public com sucesso!');
