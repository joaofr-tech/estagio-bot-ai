const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { writeFileAtomically } = require('./repository');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_ALERT_STATE_PATH = path.join(ROOT_DIR, '.last_alert.json');
const ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 horas

/**
 * Rotaciona arquivo de log quando excede maxBytes (padrão 512 KB),
 * arquivando a primeira metade em .old.txt e mantendo a metade mais recente.
 */
function rotacionarLogSeNecessario(logPath, maxBytes = 524288) {
  if (!logPath || !fs.existsSync(logPath)) {
    return { rotated: false, previousSize: 0, newSize: 0 };
  }

  const stats = fs.statSync(logPath);
  if (stats.size <= maxBytes) {
    return { rotated: false, previousSize: stats.size, newSize: stats.size };
  }

  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split(/\r?\n/);

  let headLines;
  let tailLines;

  if (lines.length > 1) {
    const mid = Math.floor(lines.length / 2);
    headLines = lines.slice(0, mid).join('\n');
    tailLines = lines.slice(mid).join('\n');
  } else {
    const midByte = Math.floor(content.length / 2);
    headLines = content.slice(0, midByte);
    tailLines = content.slice(midByte);
  }

  const parsed = path.parse(logPath);
  const oldLogPath = path.join(parsed.dir, `${parsed.name}.old${parsed.ext || '.txt'}`);

  writeFileAtomically(oldLogPath, headLines);
  writeFileAtomically(logPath, tailLines);

  const newStats = fs.statSync(logPath);
  return {
    rotated: true,
    previousSize: stats.size,
    newSize: newStats.size,
    oldLogPath
  };
}

function postJsonWebhook(webhookUrl, payload, timeoutMs = 8000) {
  return new Promise(resolve => {
    let parsed;
    try {
      parsed = new URL(webhookUrl);
    } catch (e) {
      return resolve({ ok: false, error: `Webhook URL inválida: ${e.message}` });
    }

    const body = JSON.stringify(payload);
    const client = parsed.protocol === 'http:' ? http : https;

    const req = client.request(
      webhookUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: timeoutMs
      },
      res => {
        res.resume();
        res.on('end', () => {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode });
        });
      }
    );

    req.on('error', err => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Webhook timeout' });
    });

    req.write(body);
    req.end();
  });
}

/**
 * Avalia saúde do pipeline e dispara alerta ativo (com throttling de 6h)
 * quando status === 'critical' ou falhasConsecutivas >= 3.
 */
async function verificarEDispararAlertaSaude(healthData, options = {}) {
  if (!healthData) return { sent: false, reason: 'Sem dados de saúde' };

  const isCritical = healthData.status === 'critical' || (healthData.falhasConsecutivas || 0) >= 3;
  if (!isCritical) {
    return { sent: false, reason: 'Status não crítico' };
  }

  const statePath = options.alertStatePath || DEFAULT_ALERT_STATE_PATH;
  const now = options.nowMs || Date.now();

  if (fs.existsSync(statePath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (prev.lastAlertAtMs && (now - prev.lastAlertAtMs) < ALERT_THROTTLE_MS) {
        return { sent: false, reason: 'Throttled (alerta recente < 6h)' };
      }
    } catch (e) {}
  }

  const payload = {
    projeto: 'Sona (EstágioBot AI)',
    nivel: 'CRITICAL',
    status: healthData.status,
    falhasConsecutivas: healthData.falhasConsecutivas,
    ultimaExecucao: healthData.ultimaExecucao,
    mensagem: healthData.mensagem,
    avisosFontes: healthData.avisosFontes || []
  };

  let disparado = false;

  if (process.env.ALERT_WEBHOOK_URL) {
    const res = await postJsonWebhook(process.env.ALERT_WEBHOOK_URL, {
      content: `🚨 **[Sona ETL - ALERTA CRÍTICO]** ${healthData.falhasConsecutivas} falhas consecutivas. Motivo: ${healthData.mensagem}`,
      ...payload
    });
    if (res.ok) {
      console.log('[Alerta Saúde] Webhook de alerta enviado com sucesso.');
      disparado = true;
    } else {
      console.warn('[Alerta Saúde] Falha ao enviar webhook:', res.error || `HTTP ${res.statusCode}`);
    }
  }

  if (process.env.EMAIL_ADDRESS && process.env.EMAIL_PASSWORD) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_ADDRESS,
          pass: process.env.EMAIL_PASSWORD
        }
      });

      await transporter.sendMail({
        from: `"Sona Observabilidade" <${process.env.EMAIL_ADDRESS}>`,
        to: process.env.EMAIL_ADDRESS,
        subject: `🚨 [Sona ETL] Alerta Crítico (${healthData.falhasConsecutivas} falhas consecutivas)`,
        text: JSON.stringify(payload, null, 2)
      });
      console.log('[Alerta Saúde] E-mail de alerta crítico enviado.');
      disparado = true;
    } catch (err) {
      console.warn('[Alerta Saúde] Falha ao enviar e-mail de alerta:', err.message);
    }
  }

  if (!disparado) {
    console.warn(`[Alerta Saúde] ⚠️ ESTADO CRÍTICO DETECTADO (sem canal externo configurado): ${JSON.stringify(payload)}`);
  }

  try {
    writeFileAtomically(
      statePath,
      JSON.stringify({ lastAlertAtMs: now, lastStatus: healthData.status, falhas: healthData.falhasConsecutivas }, null, 2)
    );
  } catch (e) {}

  return { sent: disparado, critical: true, payload };
}

module.exports = {
  rotacionarLogSeNecessario,
  verificarEDispararAlertaSaude,
  ALERT_THROTTLE_MS
};
