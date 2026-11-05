const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 3141;
const PROJECT_DIR = __dirname;

const { descartarVaga, carregarRegrasMismatch } = require('./gerenciar_mismatch');
const { salvarConfig } = require('./atualizar_config_busca');
const { concluirEtapaVaga } = require('./gerenciador_vagas');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  // Configurar CORS irrestrito para permitir integração com dashboard aberto via file:///
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // API: Receber descarte por mismatch
  if (req.method === 'POST' && pathname === '/api/mismatch') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { canonicalKey, motivo, detalhe } = payload;
        const resultado = descartarVaga(canonicalKey, motivo, detalhe);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', resultado }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
    });
    return;
  }

  // API: Salvar parâmetros de busca
  if (req.method === 'POST' && pathname === '/api/config') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const cfg = JSON.parse(body);
        salvarConfig(cfg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
    });
    return;
  }

  // API: Listar regras aprendidas
  if (req.method === 'GET' && pathname === '/api/regras') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(carregarRegrasMismatch()));
  }

  // API: Concluir etapa pendente
  if (req.method === 'POST' && pathname === '/api/concluir-etapa') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { canonicalKey } = payload;
        const resultado = concluirEtapaVaga(canonicalKey);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', resultado }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
    });
    return;
  }

  // API: Disparar verificação de e-mails sob demanda
  if (req.method === 'POST' && pathname === '/api/verificar-emails') {
    const { verificarCaixaEntrada } = require('./verificar_emails');
    verificarCaixaEntrada().then(resultado => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resultado));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sucesso: false, erro: err.message }));
    });
    return;
  }

  // Servir arquivos estáticos (dashboard.html como raiz)
  let filePath = path.join(PROJECT_DIR, pathname === '/' ? 'dashboard.html' : pathname);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PROJECT_DIR, 'dashboard.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Arquivo não encontrado');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`[Dashboard Bridge] Servidor ativo em http://localhost:${PORT}`);
});

module.exports = server;
