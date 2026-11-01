const fs = require('fs');
const path = require('path');

const CONFIG_JSON_PATH = path.join(__dirname, 'config_busca.json');
const CONFIG_JS_PATH = path.join(__dirname, 'config_busca.js');

function salvarConfig(config) {
  fs.writeFileSync(CONFIG_JSON_PATH, JSON.stringify(config, null, 2), 'utf8');
  fs.writeFileSync(CONFIG_JS_PATH, `window.CONFIG_BUSCA = ${JSON.stringify(config, null, 2)};\n`, 'utf8');
  console.log('[Configuração] Parâmetros de busca salvos com sucesso!');
}

if (require.main === module) {
  const payload = process.argv[2];
  if (payload) {
    try {
      const cfg = JSON.parse(payload);
      salvarConfig(cfg);
    } catch (e) {
      console.error('Erro ao processar JSON de configuração:', e.message);
    }
  }
}

module.exports = { salvarConfig };
