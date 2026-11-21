from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any

from .extractors.http_client import fetch_with_retry
from .models import AuditMetrics
from .repository import atualizar_status_vagas

GENERIC_PATTERNS = [
    (re.compile(r"vaga encerrada", re.I), "Vaga encerrada"),
    (re.compile(r"processo seletivo encerrado", re.I), "Processo seletivo encerrado"),
    (re.compile(r"não aceita mais candidaturas", re.I), "Não aceita mais candidaturas"),
    (re.compile(r"inscrições encerradas", re.I), "Inscrições encerradas"),
    (re.compile(r"candidaturas encerradas", re.I), "Candidaturas encerradas"),
    (re.compile(r"esta vaga expirou", re.I), "Esta vaga expirou"),
    (re.compile(r"esta vaga foi finalizada", re.I), "Esta vaga foi finalizada"),
    (re.compile(r"esta oportunidade não está mais disponível", re.I), "Oportunidade indisponível"),
    (re.compile(r"vaga desativada", re.I), "Vaga desativada"),
    (re.compile(r"vaga inexistente", re.I), "Vaga inexistente"),
    (re.compile(r"vaga não encontrada", re.I), "Vaga não encontrada"),
    (re.compile(r"página não encontrada", re.I), "Página não encontrada (404)"),
    (re.compile(r"page not found", re.I), "Página não encontrada (Page Not Found)"),
    (re.compile(r"no longer accepting applications", re.I), "Inscrições não são mais aceitas"),
    (re.compile(r"this job is no longer available", re.I), "Vaga não disponível"),
    (re.compile(r"job posting has expired", re.I), "Anúncio de vaga expirado"),
    (re.compile(r"this position has been filled", re.I), "Posição já preenchida"),
]


def _verificar_linkedin(url: str) -> dict[str, Any]:
    m = re.search(r"(\d{8,12})", url)
    job_id = m.group(1) if m else url
    api_url = f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}"
    resp = fetch_with_retry(api_url, retries=1, timeout=8.5)

    if resp.status_code in (404, 410):
        return {"encerrada": True, "motivo": f"LinkedIn HTTP {resp.status_code}: Vaga não existe mais"}
    if resp.final_url and ("/jobs/search" in resp.final_url or resp.final_url.rstrip("/").endswith("/jobs")):
        return {"encerrada": True, "motivo": "LinkedIn: Redirecionada para busca de vagas"}
    if not resp.ok:
        return {"encerrada": False, "indeterminado": True, "motivo": f"LinkedIn HTTP {resp.status_code}"}

    html = resp.body
    if re.search(r"não aceita mais candidaturas|no longer accepting applications|vaga encerrada|processo seletivo encerrado", html, re.I):
        return {"encerrada": True, "motivo": "LinkedIn: Não aceita mais candidaturas"}

    has_apply = any(
        marker in html
        for marker in (
            "top-card-layout__cta--primary",
            "apply-button",
            "job-details-topcard-apply-modal",
            "public_jobs_apply-link-offsite",
        )
    )
    if not has_apply:
        return {"encerrada": True, "motivo": "LinkedIn: Botão de candidatura ausente"}
    return {"encerrada": False, "motivo": "LinkedIn: Vaga ativa"}


def _verificar_gupy(url: str) -> dict[str, Any]:
    resp = fetch_with_retry(url, retries=1, timeout=8.5)
    if resp.status_code in (404, 410):
        return {"encerrada": True, "motivo": f"Gupy HTTP {resp.status_code}: Vaga inexistente"}
    if not resp.ok:
        return {"encerrada": False, "indeterminado": True, "motivo": resp.error or f"Gupy HTTP {resp.status_code}"}

    html = resp.body
    idx = html.find('id="__NEXT_DATA__"')
    if idx != -1:
        start = html.find(">", idx) + 1
        end = html.find("</script>", start)
        try:
            data = json.loads(html[start:end])
            job = data.get("props", {}).get("pageProps", {}).get("job")
            if isinstance(job, dict):
                if job.get("status") == "closed" or job.get("isClosed") is True:
                    return {"encerrada": True, "motivo": f"Gupy status: {job.get('status') or 'closed'}"}
                if job.get("status") == "published" and not job.get("isClosed"):
                    return {"encerrada": False, "motivo": "Gupy: Vaga publicada e ativa"}
        except Exception:
            pass

    if re.search(r"vaga encerrada|inscrições encerradas|candidaturas encerradas|não está mais disponível|página não encontrada|vaga não encontrada", html, re.I):
        return {"encerrada": True, "motivo": "Gupy: Texto de vaga encerrada detectado"}
    return {"encerrada": False, "motivo": "Gupy: Página ativa"}


def _verificar_generico(url: str) -> dict[str, Any]:
    resp = fetch_with_retry(url, retries=1, timeout=9.0)
    if resp.error and not resp.status_code:
        if re.search(r"name or service not known|getaddrinfo|ENOTFOUND|NameResolutionError", resp.error, re.I):
            return {"encerrada": True, "motivo": "Domínio/DNS inexistente"}
        return {"encerrada": False, "indeterminado": True, "motivo": resp.error}

    if resp.status_code in (404, 410):
        return {"encerrada": True, "motivo": f"HTTP {resp.status_code} (vaga inexistente)"}
    if not resp.ok:
        return {"encerrada": False, "indeterminado": True, "motivo": f"HTTP {resp.status_code}"}

    final_url = resp.final_url or url
    if "linkedin.com/jobs/view/" in final_url:
        return _verificar_linkedin(final_url)
    if ".gupy.io/jobs/" in final_url:
        return _verificar_gupy(final_url)

    for pattern, motivo in GENERIC_PATTERNS:
        if pattern.search(resp.body):
            return {"encerrada": True, "motivo": f"Anúncio finalizado: {motivo}"}

    return {"encerrada": False, "motivo": "Página acessível"}


def validar_vaga_ativa(vaga: dict[str, Any]) -> dict[str, Any]:
    link = (vaga.get("link") or "").strip()
    if not link or link == "#":
        return {"encerrada": True, "motivo": "Vaga sem link válido"}
    if "vertexaisearch.cloud.google.com" in link.lower() or "grounding-api-redirect" in link.lower():
        return {"encerrada": True, "motivo": "Link temporário de grounding expirado"}
    try:
        if "linkedin.com/jobs/view/" in link:
            return _verificar_linkedin(link)
        if ".gupy.io/jobs/" in link:
            return _verificar_gupy(link)
        return _verificar_generico(link)
    except Exception as exc:
        return {"encerrada": False, "indeterminado": True, "motivo": str(exc)}


def auditar_vagas_ativas(
    vagas_atuais: list[dict[str, Any]],
    limite: int = 60,
    skip_network: bool = False,
) -> AuditMetrics:
    """
    Audita vagas abertas em fila circular (menos recentemente auditadas primeiro)
    e sincroniza vagas encerradas e carimbos `updated_at` direto no Supabase.
    """
    if skip_network or not vagas_atuais:
        return AuditMetrics(verificadas=0, encerradasCount=0)

    abertas = [v for v in vagas_atuais if not v.get("status") or v.get("status") == "para_aplicar"]
    abertas.sort(key=lambda v: v.get("ultimaAuditoriaMs") or 0)
    lote = abertas[:limite]
    if not lote:
        return AuditMetrics(verificadas=0, encerradasCount=0)

    print(f"[Auditoria] Verificando {len(lote)} vaga(s) aberta(s) em fila circular...")
    data_hoje = datetime.now().strftime("%d/%m/%Y, %H:%M:%S")
    encerradas_count = 0
    vagas_para_atualizar: list[dict[str, Any]] = []

    def _checar(vaga: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        res = validar_vaga_ativa(vaga)
        time.sleep(0.12)
        return vaga, res

    with ThreadPoolExecutor(max_workers=6) as pool:
        for vaga, res in pool.map(_checar, lote):
            agora_ms = int(time.time() * 1000)
            if res.get("encerrada"):
                encerradas_count += 1
                vaga["status"] = "encerrada"
                vaga["dataEncerramento"] = data_hoje
                vaga["motivoEncerramento"] = res.get("motivo")
                vaga["ultimaAuditoriaMs"] = agora_ms
                vagas_para_atualizar.append(vaga)
                print(f"  ❌ [ENCERRADA] {vaga.get('empresa')} - {vaga.get('cargo')} ({res.get('motivo')})")
            elif not res.get("indeterminado"):
                vaga["ultimaAuditoriaMs"] = agora_ms
                vagas_para_atualizar.append(vaga)

    if vagas_para_atualizar:
        atualizar_status_vagas(vagas_para_atualizar, skip_network=skip_network)

    return AuditMetrics(verificadas=len(lote), encerradasCount=encerradas_count)
