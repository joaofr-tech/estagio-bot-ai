const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

const server = http.createServer(async (req, res) => {
  // CORS habilitado para leitura e endpoints /api locais
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-LLM-Provider, X-LLM-Key, X-LLM-Model, X-GitHub-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let reqPath = decodeURI(req.url.split('?')[0]);

  // Roteamento local para Vercel Serverless Functions (/api/*)
  if (reqPath.startsWith('/api/')) {
    const endpoint = reqPath.replace(/^\/api\//, '').replace(/[^a-zA-Z0-9_-]/g, '');
    const handlerPath = path.join(DIR, 'api', `${endpoint}.js`);
    if (!fs.existsSync(handlerPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `Endpoint /api/${endpoint} não encontrado.` }));
      return;
    }

    // Parse JSON body
    let rawBody = '';
    for await (const chunk of req) {
      rawBody += chunk;
    }
    try {
      req.body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      req.body = {};
    }

    // Helpers compatíveis com Vercel (res.status().json())
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (payload) => {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(payload));
      return res;
    };

    try {
      // Limpa cache de /api/* e /api/_lib/* em modo dev local
      Object.keys(require.cache).forEach((k) => {
        if (k.includes(`${path.sep}api${path.sep}`)) delete require.cache[k];
      });
      const handler = require(handlerPath);
      await handler(req, res);
    } catch (err) {
      console.error(`[API /api/${endpoint}] Erro:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Erro interno no servidor local.' });
      }
    }
    return;
  }

  if (reqPath === '/' || reqPath === '') {
    reqPath = '/dashboard.html';
  }

  const filePath = path.normalize(path.join(DIR, reqPath));

  // Proteção contra Directory Traversal
  if (!filePath.startsWith(DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Proibido');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Arquivo não encontrado');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Headers para evitar cache agressivo no desenvolvimento local
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ['.json', '.js', '.css', '.html'].includes(ext) ? 'no-cache' : 'max-age=3600'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n======================================================');
  console.log('📡 Servidor EstágioBot Iniciado!');
  console.log('======================================================');
  console.log(`💻 Localmente no notebook:   http://localhost:${PORT}`);
  
  const ips = getLocalIPs();
  if (ips.length > 0) {
    console.log(`🌐 No seu computador ou celular (mesmo Wi-Fi):`);
    ips.forEach(ip => {
      console.log(`   👉 http://${ip}:${PORT}`);
    });
  } else {
    console.log(`🌐 Para acessar de outro PC, use o IP local do notebook na porta ${PORT}`);
  }
  console.log('======================================================\n');
});
