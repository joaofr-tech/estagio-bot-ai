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

const server = http.createServer((req, res) => {
  // CORS habilitado para leitura facilitada
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let reqPath = decodeURI(req.url.split('?')[0]);
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

    // Headers para evitar cache agressivo no banco_vagas e garantir dados frescos
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.json' || ext === '.js' ? 'no-cache' : 'max-age=3600'
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
