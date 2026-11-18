from __future__ import annotations

import json
import re
import time
import unicodedata
from typing import Any
from urllib.parse import quote

from .http_client import fetch_with_retry


def _normalizar_sem_acento(texto: str | None) -> str:
    nfd = unicodedata.normalize("NFD", (texto or "").lower())
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn").strip()


def extrair_next_data(html: str) -> dict[str, Any] | None:
    idx = html.find('id="__NEXT_DATA__"')
    if idx == -1:
        return None
    start = html.find(">", idx)
    if start == -1:
        return None
    end = html.find("</script>", start + 1)
    if end == -1:
        return None
    try:
        return json.loads(html[start + 1 : end])
    except Exception:
        return None


def _vaga_compativel_com_local(job: dict[str, Any], config: dict[str, Any]) -> bool:
    wt = _normalizar_sem_acento(job.get("workplaceType"))
    is_remoto = bool(job.get("isRemoteWork")) or wt == "remote"
    if is_remoto:
        return config.get("aceitaRemoto", True) is not False

    cidades_cfg = config.get("cidades")
    cidades_alvo = (
        [_normalizar_sem_acento(c) for c in cidades_cfg]
        if isinstance(cidades_cfg, list) and cidades_cfg
        else ["belo horizonte", "contagem", "betim", "nova lima", "ibirite"]
    )
    city_norm = _normalizar_sem_acento(job.get("city"))
    return any(c in city_norm for c in cidades_alvo)


def _build_gupy_link(job: dict[str, Any]) -> str:
    job_url = (job.get("jobUrl") or "").strip()
    if re.match(r"^https?://", job_url, re.I):
        return job_url
    career_url = (job.get("careerPageUrl") or "").strip()
    if career_url and job.get("id"):
        return f"{career_url.rstrip('/')}/jobs/{job['id']}"
    career_name = (job.get("careerPageName") or "").strip()
    if career_name and job.get("id"):
        slug = re.sub(r"[^a-z0-9]", "", _normalizar_sem_acento(career_name))
        if slug:
            return f"https://{slug}.gupy.io/jobs/{job['id']}"
    return f"https://portal.gupy.io/job-search/term={quote(job.get('name') or 'estagio')}"


def extract(config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Extrai vagas de estágio em tecnologia do portal Gupy via __NEXT_DATA__."""
    config = config or {}
    t0 = time.monotonic()
    termos = ["estagio desenvolvimento", "estagio dados"]
    urls = [f"https://portal.gupy.io/job-search/term={quote(t)}" for t in termos]

    por_id: dict[str, dict[str, Any]] = {}
    requisicoes_ok = 0
    ultimo_erro: str | None = None

    for url in urls:
        resp = fetch_with_retry(url, retries=2, timeout=10.0)
        if not resp.ok:
            ultimo_erro = resp.error or f"HTTP {resp.status_code}"
            continue

        next_data = extrair_next_data(resp.body)
        if not next_data:
            ultimo_erro = "Estrutura __NEXT_DATA__ não encontrada no portal Gupy"
            continue

        requisicoes_ok += 1
        data_list = next_data.get("props", {}).get("pageProps", {}).get("data", []) or []
        for j in data_list:
            cargo = (j.get("name") or "").strip()
            norm_cargo = _normalizar_sem_acento(cargo)
            norm_type = _normalizar_sem_acento(j.get("type"))
            if not ("estag" in norm_cargo or "intern" in norm_cargo or "internship" in norm_type):
                continue
            if not _vaga_compativel_com_local(j, config):
                continue

            key = str(j.get("id") or f"{j.get('careerPageName')}::{cargo}")
            if key in por_id:
                continue

            wt = _normalizar_sem_acento(j.get("workplaceType"))
            if j.get("isRemoteWork") or wt == "remote":
                modalidade = "Remoto"
            elif wt == "hybrid":
                modalidade = "Híbrido"
            else:
                modalidade = "Presencial"

            loc_partes = [p for p in (j.get("city"), j.get("state")) if p]
            localizacao = "Remoto - Brasil" if modalidade == "Remoto" else ("/".join(loc_partes) or "Minas Gerais")
            desc_limpa = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", j.get("description") or "")).strip()[:280]

            por_id[key] = {
                "empresa": (j.get("careerPageName") or j.get("companyName") or "Empresa via Gupy").strip(),
                "cargo": cargo,
                "modalidade": modalidade,
                "localizacao": localizacao,
                "turno": "Tarde / Flexível",
                "prazo": f"Prazo: {j['applicationDeadline']}" if j.get("applicationDeadline") else "Inscrições Abertas",
                "requisitos": desc_limpa or "Estágio em Tecnologia / Desenvolvimento (Gupy)",
                "link": _build_gupy_link(j),
                "fonte": "gupy",
            }

    ok = requisicoes_ok > 0
    return {
        "source": "gupy",
        "ok": ok,
        "jobs": list(por_id.values()),
        "durationMs": int((time.monotonic() - t0) * 1000),
        "error": None if ok else (ultimo_erro or "Falha ao consultar portal Gupy"),
    }
