from __future__ import annotations

import html
import json
import os
import smtplib
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any

import httpx

from .repository import ROOT_DIR, atualizar_status_vagas, write_file_atomically

DEFAULT_ALERT_STATE_PATH = ROOT_DIR / ".last_alert.json"
ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000  # 6 horas


def rotacionar_log_se_necessario(log_path: str | Path, max_bytes: int = 524288) -> dict[str, Any]:
    """Mantém a metade mais recente do log quando exceder max_bytes, arquivando a anterior em .old.txt."""
    path = Path(log_path)
    if not path.exists():
        return {"rotated": False, "previousSize": 0, "newSize": 0}

    prev_size = path.stat().st_size
    if prev_size <= max_bytes:
        return {"rotated": False, "previousSize": prev_size, "newSize": prev_size}

    content = path.read_text(encoding="utf-8", errors="replace")
    lines = content.splitlines()
    if len(lines) > 1:
        mid = len(lines) // 2
        head = "\n".join(lines[:mid])
        tail = "\n".join(lines[mid:])
    else:
        mid_b = len(content) // 2
        head = content[:mid_b]
        tail = content[mid_b:]

    old_path = path.with_name(f"{path.stem}.old{path.suffix or '.txt'}")
    write_file_atomically(old_path, head)
    write_file_atomically(path, tail)

    return {
        "rotated": True,
        "previousSize": prev_size,
        "newSize": path.stat().st_size,
        "oldLogPath": str(old_path),
    }


def _render_digest_html(vagas: list[dict[str, Any]], total_pendentes: int) -> str:
    itens = []
    for v in vagas:
        empresa = html.escape(str(v.get("empresa") or ""))
        cargo = html.escape(str(v.get("cargo") or ""))
        loc = html.escape(str(v.get("localizacao") or v.get("modalidade") or ""))
        turno = html.escape(str(v.get("turno") or ""))
        link = html.escape(str(v.get("link") or "#"))
        itens.append(
            f"""
            <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:12px;background:#ffffff;">
              <div style="font-size:15px;font-weight:700;color:#0f172a;">{cargo}</div>
              <div style="font-size:13px;color:#475569;margin:4px 0;">{empresa} &bull; {loc} &bull; {turno}</div>
              <a href="{link}" style="display:inline-block;margin-top:6px;padding:6px 12px;background:#d97706;color:#ffffff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700;">Candidatar-se</a>
            </div>
            """
        )
    restantes = max(0, total_pendentes - len(vagas))
    rodape = f"<p style='color:#64748b;font-size:12px;'>+ {restantes} outra(s) vaga(s) aguardando no dashboard.</p>" if restantes else ""
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#faf7f2;color:#1e293b;">
      <h2 style="margin-top:0;">🎯 Sona — Top {len(vagas)} Vagas Selecionadas</h2>
      {"".join(itens)}
      {rodape}
    </div>
    """


def enviar_digest_email_pendentes(
    vagas_atuais: list[dict[str, Any]],
    max_vagas: int = 5,
    skip_network: bool = False,
) -> int:
    """Envia digest SMTP das vagas inéditas ainda não notificadas e marca notificada=True."""
    email_addr = os.environ.get("EMAIL_ADDRESS", "").strip()
    email_pass = os.environ.get("EMAIL_PASSWORD", "").strip()
    if skip_network or not email_addr or not email_pass:
        return 0

    pendentes = [
        v for v in vagas_atuais
        if v.get("notificada") is False and v.get("status") not in ("encerrada", "descartada")
    ]
    if not pendentes:
        return 0

    lote = pendentes[:max_vagas]
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"🎯 Top Oportunidades de Estágio Selecionadas ({len(lote)})"
    msg["From"] = f"Sona ETL <{email_addr}>"
    msg["To"] = email_addr
    msg.attach(MIMEText(_render_digest_html(lote, len(pendentes)), "html", "utf-8"))

    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
            server.starttls()
            server.login(email_addr, email_pass)
            server.sendmail(email_addr, [email_addr], msg.as_string())

        for v in lote:
            v["notificada"] = True
        atualizar_status_vagas(lote, skip_network=skip_network)
        print(f"[Notificador] E-mail enviado com {len(lote)} vaga(s) marcada(s) como notificadas.")
        return len(lote)
    except Exception as exc:
        print(f"[Notificador] Falha ao enviar digest SMTP: {exc}")
        return 0


def verificar_e_disparar_alerta_saude(
    health_data: dict[str, Any] | None,
    alert_state_path: str | Path = DEFAULT_ALERT_STATE_PATH,
    now_ms: int | None = None,
    skip_network: bool = False,
) -> dict[str, Any]:
    """Dispara alerta ativo (Webhook/SMTP) com throttling de 6h quando o pipeline entra em estado crítico."""
    if not health_data:
        return {"sent": False, "reason": "Sem dados de saúde"}

    is_critical = health_data.get("status") == "critical" or (health_data.get("falhasConsecutivas") or 0) >= 3
    if not is_critical:
        return {"sent": False, "reason": "Status não crítico"}

    state_file = Path(alert_state_path)
    now = now_ms if now_ms is not None else int(time.time() * 1000)

    if state_file.exists():
        try:
            prev = json.loads(state_file.read_text(encoding="utf-8"))
            if prev.get("lastAlertAtMs") and (now - prev["lastAlertAtMs"]) < ALERT_THROTTLE_MS:
                return {"sent": False, "reason": "Throttled (< 6h)"}
        except Exception:
            pass

    payload = {
        "projeto": "Sona ETL (Python)",
        "nivel": "CRITICAL",
        "status": health_data.get("status"),
        "falhasConsecutivas": health_data.get("falhasConsecutivas"),
        "ultimaExecucao": health_data.get("ultimaExecucao"),
        "mensagem": health_data.get("mensagem"),
        "avisosFontes": health_data.get("avisosFontes", []),
    }

    disparado = False
    webhook_url = os.environ.get("ALERT_WEBHOOK_URL", "").strip()
    if not skip_network and webhook_url:
        try:
            resp = httpx.post(
                webhook_url,
                json={
                    "content": f"🚨 **[Sona Python ETL - ALERTA CRÍTICO]** {payload['falhasConsecutivas']} falhas consecutivas. Motivo: {payload['mensagem']}",
                    **payload,
                },
                timeout=8.0,
            )
            if 200 <= resp.status_code < 300:
                disparado = True
        except Exception as exc:
            print(f"[Alerta Saúde] Falha ao enviar webhook: {exc}")

    email_addr = os.environ.get("EMAIL_ADDRESS", "").strip()
    email_pass = os.environ.get("EMAIL_PASSWORD", "").strip()
    if not skip_network and email_addr and email_pass:
        try:
            msg = MIMEText(json.dumps(payload, indent=2, ensure_ascii=False), "plain", "utf-8")
            msg["Subject"] = f"🚨 [Sona ETL] Alerta Crítico ({payload['falhasConsecutivas']} falhas consecutivas)"
            msg["From"] = email_addr
            msg["To"] = email_addr
            with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
                server.starttls()
                server.login(email_addr, email_pass)
                server.sendmail(email_addr, [email_addr], msg.as_string())
            disparado = True
        except Exception as exc:
            print(f"[Alerta Saúde] Falha ao enviar e-mail de alerta: {exc}")

    if not disparado:
        print(f"[Alerta Saúde] ⚠️ ESTADO CRÍTICO DETECTADO: {json.dumps(payload, ensure_ascii=False)}")

    write_file_atomically(
        state_file,
        json.dumps(
            {
                "lastAlertAtMs": now,
                "lastStatus": health_data.get("status"),
                "falhas": health_data.get("falhasConsecutivas"),
            },
            indent=2,
        ),
    )
    return {"sent": disparado, "critical": True, "payload": payload}
