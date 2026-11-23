const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DIR = path.resolve(__dirname);

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

const BLOCKED_FILENAMES = new Set([
  'email_config.json',
  'server.js',
  'servidor.js',
  'supabase_client.js',
  'package.json',
  'package-lock.json'
]);

const BLOCKED_DIRS = new Set(['api', 'docs', 'etl', 'node_modules', 'scripts', 'src', 'tests', 'tests_py']);

function isSensitiveOrUnsafePath(rootDir, candidatePath) {
  const rel = path.relative(rootDir, candidatePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return true;

  const segments = rel.split(path.sep).filter(Boolean);
  if (segments.some((seg) => seg.startsWith('.'))) return true;
  if (BLOCKED_DIRS.has(segments[0].toLowerCase())) return true;

  const base = segments[segments.length - 1].toLowerCase();
  if (BLOCKED_FILENAMES.has(base)) return true;
  if (base.endsWith('.sql') || base.endsWith('.bak') || base.endsWith('.backup.json') || base.endsWith('.ps1')) {
    return true;
  }
  return false;
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Confirm-Delete, X-LLM-Provider, X-LLM-Key, X-LLM-Model, X-GitHub-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let reqPath;
  try {
    reqPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Requisição inválida');
    return;
  }

  // Roteamento local para Vercel Serverless Functions (/api/*)
  if (reqPath.startsWith('/api/')) {
    const endpoint = reqPath.replace(/^\/api\//, '').replace(/[^a-zA-Z0-9_-]/g, '');
    const handlerPath = path.join(DIR, 'api', `${endpoint}.js`);
    if (!endpoint || !fs.existsSync(handlerPath)) {
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

  const filePath = path.resolve(DIR, `.${reqPath}`);

  // Proteção rigorosa contra Directory Traversal e exposição de dotfiles/arquivos sensíveis
  if (isSensitiveOrUnsafePath(DIR, filePath)) {
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

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('\n======================================================');
    console.log('📡 Servidor Local Sona Iniciado!');
    console.log('======================================================');
    console.log(`💻 Acesso local: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);

    if (HOST === '0.0.0.0') {
      const ips = getLocalIPs();
      if (ips.length > 0) {
        console.log('🌐 Na rede local (Wi-Fi):');
        ips.forEach(ip => {
          console.log(`   👉 http://${ip}:${PORT}`);
        });
      }
    } else {
      console.log('🔒 Vinculado apenas a localhost (use HOST=0.0.0.0 para expor na rede local).');
    }
    console.log('======================================================\n');
  });
}

module.exports = { server, isSensitiveOrUnsafePath };
