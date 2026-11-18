const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function singleFetch(targetUrl, options = {}, maxRedirects = 5, timeoutMs = 10000) {
  return new Promise(resolve => {
    if (!targetUrl || maxRedirects < 0) {
      return resolve({
        ok: false,
        statusCode: 0,
        body: '',
        finalUrl: targetUrl,
        error: 'URL inválida ou excesso de redirecionamentos'
      });
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return resolve({
        ok: false,
        statusCode: 0,
        body: '',
        finalUrl: targetUrl,
        error: `URL malformada: ${e.message}`
      });
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const headers = {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      ...(options.headers || {})
    };

    const req = client.request(
      targetUrl,
      {
        method: options.method || 'GET',
        headers,
        timeout: timeoutMs
      },
      res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          let redirectUrl = res.headers.location;
          try {
            redirectUrl = new URL(redirectUrl, targetUrl).href;
          } catch (e) {}
          res.resume();
          req.destroy();
          return resolve(singleFetch(redirectUrl, options, maxRedirects - 1, timeoutMs));
        }

        let data = '';
        const MAX_BYTES = 2 * 1024 * 1024;
        res.setEncoding('utf8');
        res.on('data', chunk => {
          if (data.length < MAX_BYTES) {
            data += chunk;
          } else {
            req.destroy();
          }
        });
        res.on('end', () => {
          const ok = res.statusCode >= 200 && res.statusCode < 400;
          resolve({
            ok,
            statusCode: res.statusCode,
            body: data,
            finalUrl: targetUrl,
            error: ok ? null : `HTTP ${res.statusCode}`
          });
        });
      }
    );

    req.on('error', err => {
      resolve({
        ok: false,
        statusCode: 0,
        body: '',
        finalUrl: targetUrl,
        error: err.message || 'Erro de rede'
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        ok: false,
        statusCode: 408,
        body: '',
        finalUrl: targetUrl,
        error: `Timeout após ${timeoutMs}ms`
      });
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Executa requisição HTTP/HTTPS com redirecionamentos e retry com backoff exponencial.
 */
async function fetchWithRetry(url, options = {}, retries = 2, timeoutMs = 10000) {
  const maxRedirects = options.maxRedirects !== undefined ? options.maxRedirects : 5;
  let lastResult = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    lastResult = await singleFetch(url, options, maxRedirects, timeoutMs);

    if (lastResult.ok) {
      return lastResult;
    }

    // Não repetir para erros definitivos de cliente (exceto 408 Timeout e 429 Rate Limit)
    const status = lastResult.statusCode;
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      return lastResult;
    }

    if (attempt < retries) {
      const backoffMs = 500 * Math.pow(3, attempt); // 500ms, 1500ms
      await sleep(backoffMs);
    }
  }

  return lastResult;
}

module.exports = {
  fetchWithRetry,
  DEFAULT_USER_AGENT
};
