#!/usr/bin/env node
'use strict';

const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_QA_PORT = 3456;

function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => resolve(false));
    srv.listen(port, host, () => {
      srv.close(() => resolve(true));
    });
  });
}

function findFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, host, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(url, timeoutMs = 10000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', () => {
        if (Date.now() - started >= timeoutMs) {
          reject(new Error(`Servidor local não respondeu em ${url} dentro de ${timeoutMs}ms.`));
          return;
        }
        setTimeout(attempt, 200);
      });
      req.setTimeout(1500, () => {
        req.destroy();
      });
    }
    attempt();
  });
}

async function startQaServer(options = {}) {
  const host = '127.0.0.1';
  const requestedPort = Number(options.port || process.env.SONA_QA_PORT || DEFAULT_QA_PORT);
  const useRandomPort = Boolean(options.randomPort);

  let port;
  if (useRandomPort) {
    port = await findFreePort(host);
  } else if (await isPortAvailable(requestedPort, host)) {
    port = requestedPort;
  } else {
    port = await findFreePort(host);
  }

  const child = spawn(process.execPath, [path.join(ROOT_DIR, 'servidor.js')], {
    cwd: ROOT_DIR,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port)
    }
  });
  child.unref();

  const url = `http://${host}:${port}`;
  await waitForServer(`${url}/dashboard.html`, 10000);
  return { url, host, port, pid: child.pid, fixedOrigin: port === requestedPort };
}

function stopQaServer(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    throw new Error(`PID inválido: ${pid}`);
  }
  try {
    process.kill(numericPid, 'SIGTERM');
    return { stopped: true, pid: numericPid };
  } catch (err) {
    if (err && err.code === 'ESRCH') {
      return { stopped: false, pid: numericPid, reason: 'already_exited' };
    }
    throw err;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  (async () => {
    try {
      if (args.includes('--start')) {
        const info = await startQaServer();
        console.log(JSON.stringify({ ok: true, ...info }));
        process.exit(0);
      }
      const stopIdx = args.indexOf('--stop');
      if (stopIdx !== -1 && args[stopIdx + 1]) {
        const result = stopQaServer(args[stopIdx + 1]);
        console.log(JSON.stringify({ ok: true, ...result }));
        process.exit(0);
      }
      console.error(JSON.stringify({ ok: false, error: 'Use --start ou --stop <pid>' }));
      process.exit(1);
    } catch (err) {
      console.error(JSON.stringify({ ok: false, error: err.message }));
      process.exit(1);
    }
  })();
}

module.exports = {
  DEFAULT_QA_PORT,
  isPortAvailable,
  findFreePort,
  waitForServer,
  startQaServer,
  stopQaServer
};
