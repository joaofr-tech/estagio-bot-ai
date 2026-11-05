const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const BANCO_PATH = path.join(__dirname, 'banco_vagas.json');
const BANCO_JS_PATH = path.join(__dirname, 'banco_vagas.js');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function carregarBanco() {
  if (!fs.existsSync(BANCO_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(BANCO_PATH, 'utf8'));
  } catch (e) {
    return [];
  }
}

function salvarBanco(banco) {
  fs.writeFileSync(BANCO_PATH, JSON.stringify(banco, null, 2), 'utf8');
  fs.writeFileSync(BANCO_JS_PATH, `window.BANCO_VAGAS = ${JSON.stringify(banco, null, 2)};\n`, 'utf8');
}

/**
 * Faz uma requisição HTTP/HTTPS com suporte a redirecionamentos automáticos.
 */
function fetchUrl(targetUrl, maxRedirects = 6, timeoutMs = 9000) {
  return new Promise((resolve) => {
    if (!targetUrl || targetUrl === '#' || maxRedirects < 0) {
      return resolve({ ok: false, statusCode: 0, html: '', finalUrl: targetUrl, error: 'Link vazio ou excesso de redirecionamentos' });
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return resolve({ ok: false, statusCode: 0, html: '', finalUrl: targetUrl, error: 'URL inválida ou malformada' });
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(targetUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: timeoutMs
    }, (res) => {
      // Tratar redirecionamentos automáticos
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        let redirectUrl = res.headers.location;
        try {
          redirectUrl = new URL(redirectUrl, targetUrl).href;
        } catch (e) {}
        req.destroy();
        return resolve(fetchUrl(redirectUrl, maxRedirects - 1, timeoutMs));
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        data += chunk;
        if (data.length > 600000) {
          req.destroy();
          resolve({ ok: true, statusCode: res.statusCode, html: data, finalUrl: targetUrl });
        }
      });
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, statusCode: res.statusCode, html: data, finalUrl: targetUrl });
      });
    });

    req.on('error', (err) => {
      resolve({ ok: false, statusCode: 0, html: '', finalUrl: targetUrl, error: err.message || 'Erro de rede' });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: 408, html: '', finalUrl: targetUrl, error: 'Timeout de conexão' });
    });
  });
}

/**
 * Validador para vagas do LinkedIn
 */
async function verificarLinkedIn(jobIdOrUrl) {
  let jobId = jobIdOrUrl;
  const match = jobIdOrUrl.match(/(\d{8,12})/);
  if (match) jobId = match[1];

  const apiUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
  const resp = await fetchUrl(apiUrl, 3, 8500);

  // Vaga deletada ou inexistente no LinkedIn
  if (resp.statusCode === 404 || resp.statusCode === 410) {
    return { encerrada: true, motivo: `LinkedIn HTTP ${resp.statusCode}: Vaga não existe mais no LinkedIn` };
  }

  // Redirecionamento para busca (vaga inexistente)
  if (resp.finalUrl && (resp.finalUrl.includes('/jobs/search') || resp.finalUrl.endsWith('/jobs/') || resp.finalUrl.endsWith('/jobs'))) {
    return { encerrada: true, motivo: 'LinkedIn: Vaga inexistente (redirecionada para a busca de vagas)' };
  }

  if (!resp.ok) {
    // Rate limit (429) ou erro temporário não encerra por falso positivo
    return { encerrada: false, indeterminado: true, motivo: `LinkedIn HTTP ${resp.statusCode}` };
  }

  const html = resp.html;

  // Frases textuais explícitas de encerramento
  const regexEncerrada = /não aceita mais candidaturas|no longer accepting applications|vaga encerrada|processo seletivo encerrado/i;
  if (regexEncerrada.test(html)) {
    return { encerrada: true, motivo: 'LinkedIn: Não aceita mais candidaturas' };
  }

  // Se o botão de candidatura (primário ou offsite) estiver ausente no layout, as candidaturas foram pausadas/encerradas
  const hasApplyAction = html.includes('top-card-layout__cta--primary') ||
                         html.includes('apply-button') ||
                         html.includes('job-details-topcard-apply-modal') ||
                         html.includes('public_jobs_apply-link-offsite');

  if (!hasApplyAction) {
    return { encerrada: true, motivo: 'LinkedIn: Botão de candidatura ausente (inscrições encerradas)' };
  }

  return { encerrada: false, motivo: 'LinkedIn: Vaga ativa com botão de candidatura' };
}

/**
 * Validador para vagas da Gupy
 */
async function verificarGupy(url) {
  const resp = await fetchUrl(url, 4, 8500);

  if (resp.statusCode === 404 || resp.statusCode === 410) {
    return { encerrada: true, motivo: `Gupy HTTP ${resp.statusCode}: Vaga inexistente` };
  }

  if (!resp.ok) {
    if (resp.error && /ENOTFOUND/i.test(resp.error)) {
      return { encerrada: true, motivo: 'Gupy: Subdomínio/Empresa inexistente (DNS não encontrado)' };
    }
    return { encerrada: false, indeterminado: true, motivo: `Gupy HTTP ${resp.statusCode}` };
  }

  const html = resp.html;

  // Analisar estado no NEXT_DATA da Gupy
  const idx = html.indexOf('id="__NEXT_DATA__"');
  if (idx !== -1) {
    const start = html.indexOf('>', idx) + 1;
    const end = html.indexOf('</script>', start);
    try {
      const json = JSON.parse(html.substring(start, end));
      const job = json.props?.pageProps?.job;
      if (job) {
        if (job.status === 'closed' || job.isClosed === true) {
          return { encerrada: true, motivo: `Gupy status: '${job.status || 'closed'}'` };
        }
        if (job.status === 'published' && !job.isClosed) {
          return { encerrada: false, motivo: 'Gupy: Vaga publicada e ativa' };
        }
      }
    } catch (e) {}
  }

  // Fallback textual para mensagens de encerramento ou página não encontrada
  const regexEncerrada = /vaga encerrada|inscrições encerradas|candidaturas encerradas|não está mais disponível|página não encontrada|vaga não encontrada/i;
  if (regexEncerrada.test(html)) {
    return { encerrada: true, motivo: 'Gupy: Texto de vaga encerrada ou inexistente detectado' };
  }

  return { encerrada: false, motivo: 'Gupy: Página ativa' };
}

/**
 * Validador genérico para outros portais e links redirecionados
 */
async function verificarGenerico(url) {
  const resp = await fetchUrl(url, 5, 9000);

  // Erros de link inexistente / domínio morto / conexão recusada
  if (resp.error) {
    if (/ENOTFOUND|getaddrinfo/i.test(resp.error)) {
      return { encerrada: true, motivo: 'Link inexistente (Domínio não existe / DNS falhou)' };
    }
    if (/ECONNREFUSED/i.test(resp.error)) {
      return { encerrada: true, motivo: 'Link inexistente (Servidor recusou conexão)' };
    }
    if (/URL inválida/i.test(resp.error)) {
      return { encerrada: true, motivo: 'Link inválido ou quebrado' };
    }
    return { encerrada: false, indeterminado: true, motivo: resp.error };
  }

  if (resp.statusCode === 404 || resp.statusCode === 410) {
    return { encerrada: true, motivo: `Página retornou HTTP ${resp.statusCode} (vaga inexistente)` };
  }

  if (!resp.ok) {
    return { encerrada: false, indeterminado: true, motivo: `HTTP ${resp.statusCode}` };
  }

  const finalUrl = resp.finalUrl || url;

  // Redirecionamento inteligente para checagem especializada
  if (finalUrl.includes('linkedin.com/jobs/view/')) {
    return verificarLinkedIn(finalUrl);
  }
  if (finalUrl.includes('.gupy.io/jobs/')) {
    return verificarGupy(finalUrl);
  }

  const html = resp.html;

  // Padrões universais de encerramento e inexistência
  const patterns = [
    { regex: /vaga encerrada/i, motivo: 'Vaga encerrada' },
    { regex: /processo seletivo encerrado/i, motivo: 'Processo seletivo encerrado' },
    { regex: /não aceita mais candidaturas/i, motivo: 'Não aceita mais candidaturas' },
    { regex: /inscrições encerradas/i, motivo: 'Inscrições encerradas' },
    { regex: /candidaturas encerradas/i, motivo: 'Candidaturas encerradas' },
    { regex: /esta vaga expirou/i, motivo: 'Esta vaga expirou' },
    { regex: /esta vaga foi finalizada/i, motivo: 'Esta vaga foi finalizada' },
    { regex: /esta oportunidade não está mais disponível/i, motivo: 'Oportunidade indisponível' },
    { regex: /vaga desativada/i, motivo: 'Vaga desativada' },
    { regex: /vaga inexistente/i, motivo: 'Vaga inexistente' },
    { regex: /vaga não encontrada/i, motivo: 'Vaga não encontrada' },
    { regex: /página não encontrada/i, motivo: 'Página não encontrada (404)' },
    { regex: /page not found/i, motivo: 'Página não encontrada (Page Not Found)' },
    { regex: /404 - página não encontrada/i, motivo: 'Erro 404' },
    { regex: /ops! não encontramos/i, motivo: 'Página não encontrada' },
    { regex: /não encontramos essa página/i, motivo: 'Página não encontrada' },
    { regex: /essa vaga já foi preenchida/i, motivo: 'Vaga já preenchida' },
    { regex: /no longer accepting applications/i, motivo: 'Inscrições não são mais aceitas' },
    { regex: /this job is no longer available/i, motivo: 'Vaga não disponível' },
    { regex: /job posting has expired/i, motivo: 'Anúncio de vaga expirado' },
    { regex: /this position has been filled/i, motivo: 'Posição já preenchida' }
  ];

  for (const item of patterns) {
    if (item.regex.test(html)) {
      return { encerrada: true, motivo: `Anúncio finalizado: ${item.motivo}` };
    }
  }

  return { encerrada: false, motivo: 'Página acessível sem aviso de encerramento' };
}

/**
 * Valida uma única vaga de forma segura
 */
async function validarVaga(vaga) {
  const link = (vaga.link || '').trim();
  if (!link || link === '#') {
    return { encerrada: true, motivo: 'Vaga sem link válido de candidatura' };
  }

  try {
    if (link.includes('linkedin.com/jobs/view/')) {
      return await verificarLinkedIn(link);
    }
    if (link.includes('.gupy.io/jobs/')) {
      return await verificarGupy(link);
    }
    return await verificarGenerico(link);
  } catch (err) {
    return { encerrada: false, indeterminado: true, motivo: `Falha na verificação: ${err.message}` };
  }
}

/**
 * Executa a auditoria em lote com concorrência controlada.
 */
async function auditarVagasAtivas(options = {}) {
  const { limite = 9999, reavaliarTodas = false } = options;
  const banco = carregarBanco();

  // Se reavaliarTodas for true, retesta tudo; senão, apenas vagas abertas
  const candidatos = reavaliarTodas 
    ? banco 
    : banco.filter(v => (!v.status || v.status === 'para_aplicar'));

  const lote = candidatos.slice(0, limite);
  console.log(`[Auditoria Geral] Iniciando verificação de ${lote.length} vaga(s) no banco de dados...`);

  let encerradasCount = 0;
  let ativasCount = 0;
  let indeterminadasCount = 0;
  const dataHoje = new Date().toLocaleString('pt-BR');

  // Concorrência de 6 conexões assíncronas simultâneas
  const CONCORRENCIA = 6;
  let cursor = 0;

  async function trabalhador() {
    while (cursor < lote.length) {
      const idx = cursor++;
      const vaga = lote[idx];

      const res = await validarVaga(vaga);

      if (res.encerrada) {
        encerradasCount++;
        vaga.status = 'encerrada';
        vaga.dataEncerramento = dataHoje;
        vaga.motivoEncerramento = res.motivo;
        console.log(`  ❌ [ENCERRADA] ${vaga.empresa} - ${vaga.cargo}`);
        console.log(`     Motivo: ${res.motivo}`);
      } else if (res.indeterminado) {
        indeterminadasCount++;
      } else {
        ativasCount++;
      }

      await new Promise(r => setTimeout(r, 120));
    }
  }

  const workers = [];
  for (let i = 0; i < CONCORRENCIA; i++) {
    workers.push(trabalhador());
  }
  await Promise.all(workers);

  if (encerradasCount > 0) {
    salvarBanco(banco);
    console.log(`\n[Auditoria Geral] Concluída! ${encerradasCount} nova(s) vaga(s) encerrada(s) ou inexistente(s) marcadas como 'encerrada'.`);
  } else {
    console.log(`\n[Auditoria Geral] Concluída! Nenhuma nova vaga encerrada detectada.`);
  }

  const totalEncerradas = banco.filter(v => v.status === 'encerrada').length;
  const totalAbertas = banco.filter(v => v.status === 'para_aplicar' || !v.status).length;
  console.log(`[Status do Banco] Vagas Abertas: ${totalAbertas} | Total de Vagas Encerradas: ${totalEncerradas}`);

  return { encerradasCount, ativasCount, indeterminadasCount, totalEncerradas, totalAbertas };
}

/**
 * Remove permanentemente vagas marcadas como encerradas da base.
 */
function expurgarVagasEncerradas() {
  const banco = carregarBanco();
  const ativas = banco.filter(v => v.status !== 'encerrada');
  const removidas = banco.length - ativas.length;
  salvarBanco(ativas);
  console.log(`[Varredura de Encerramento] ${removidas} vaga(s) encerrada(s) expurgada(s) da base.`);
  return ativas;
}

if (require.main === module) {
  const arg = process.argv[2];
  let limite = 9999;
  let reavaliar = false;

  if (arg === '--reavaliar' || arg === '--all') {
    reavaliar = true;
  } else if (arg && !isNaN(parseInt(arg, 10))) {
    limite = parseInt(arg, 10);
  }

  auditarVagasAtivas({ limite, reavaliarTodas: reavaliar }).then(() => {
    process.exit(0);
  });
}

module.exports = {
  validarVaga,
  auditarVagasAtivas,
  expurgarVagasEncerradas,
  verificarLinkedIn,
  verificarGupy,
  verificarGenerico
};
