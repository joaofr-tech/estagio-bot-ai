from __future__ import annotations

import json
import re
import time
import unicodedata
from typing import Any

from .http_client import extract_json_ld_job_postings, fetch_with_retry


def _slug(texto: str | None) -> str:
    nfd = unicodedata.normalize("NFD", (texto or "").lower())
    sem_acento = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", sem_acento).strip("-")


def extrair_next_data(html: str) -> dict[str, Any] | None:
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">([\s\S]*?)</script>', html)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except Exception:
        return None


def extract(config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Extrai vagas de estágio da Catho com proteção contra bloqueios/mudança de layout."""
    config = config or {}
    t0 = time.monotonic()
    cidades = config.get("cidades") or ["Belo Horizonte"]
    cidade_slug = _slug(cidades[0] if isinstance(cidades, list) and cidades else "Belo Horizonte")
    uf_slug = _slug(config.get("estado") or "MG")
    url = f"https://www.catho.com.br/vagas/estagio-em-desenvolvimento/{cidade_slug}-{uf_slug}/"

    resp = fetch_with_retry(url, retries=1, timeout=10.0)
    if not resp.ok:
        return {
            "source": "catho",
            "ok": False,
            "jobs": [],
            "durationMs": int((time.monotonic() - t0) * 1000),
            "error": resp.error or f"HTTP {resp.status_code}",
        }

    next_data = extrair_next_data(resp.body)
    if not next_data:
        # Fallback Nível 1 (webscraping-expert): tenta dados estruturados JSON-LD JobPosting
        ld_jobs = extract_json_ld_job_postings(resp.body)
        if not ld_jobs:
            return {
                "source": "catho",
                "ok": False,
                "jobs": [],
                "durationMs": int((time.monotonic() - t0) * 1000),
                "error": "Estrutura __NEXT_DATA__ e JSON-LD ausentes na Catho (possível bloqueio ou mudança de layout)",
            }
        cidade_padrao = cidades[0] if isinstance(cidades, list) and cidades else "Belo Horizonte"
        uf_padrao = config.get("estado") or "MG"
        fallback_jobs: list[dict[str, Any]] = []
        for jp in ld_jobs:
            cargo = str(jp.get("title") or "").strip()
            hiring = jp.get("hiringOrganization") or {}
            empresa = (hiring.get("name") if isinstance(hiring, dict) else str(hiring or "")).strip() or "Empresa via Catho"
            link = str(jp.get("url") or url).strip()
            if not cargo or not re.match(r"^https?://", link, re.I):
                continue
            desc = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(jp.get("description") or ""))).strip()[:280]
            fallback_jobs.append({
                "empresa": empresa,
                "cargo": cargo,
                "modalidade": "Remoto" if "TELECOMMUTE" in str(jp.get("jobLocationType") or "").upper() else "Presencial",
                "localizacao": f"{cidade_padrao}/{uf_padrao}",
                "turno": "Tarde / Flexível",
                "prazo": "Inscrições Abertas",
                "requisitos": desc or "Estágio em Tecnologia / Desenvolvimento (Catho JSON-LD)",
                "link": link,
                "fonte": "catho",
            })
        return {
            "source": "catho",
            "ok": bool(fallback_jobs),
            "jobs": fallback_jobs,
            "durationMs": int((time.monotonic() - t0) * 1000),
            "error": None if fallback_jobs else "JSON-LD encontrado na Catho mas sem vagas válidas",
        }

    page_props = next_data.get("props", {}).get("pageProps", {})
    raw_list = (page_props.get("jobList", {}) or {}).get("data") or page_props.get("jobs") or []

    jobs: list[dict[str, Any]] = []
    seen_links: set[str] = set()
    cidade_padrao = cidades[0] if isinstance(cidades, list) and cidades else "Belo Horizonte"
    uf_padrao = config.get("estado") or "MG"

    for j in raw_list:
        cargo = (j.get("jobTitle") or j.get("title") or "").strip()
        empresa = (j.get("companyName") or j.get("company") or "Empresa via Catho").strip()
        link = (j.get("url") or j.get("jobUrl") or "").strip()
        if link.startswith("/"):
            link = f"https://www.catho.com.br{link}"

        if not cargo or not re.match(r"^https?://", link, re.I):
            continue
        if link.lower() in seen_links:
            continue
        seen_links.add(link.lower())

        texto_mod = f"{cargo} {j.get('workModel') or ''}"
        if re.search(r"remoto|home office", texto_mod, re.I):
            modalidade = "Remoto"
        elif re.search(r"h[íi]brido", texto_mod, re.I):
            modalidade = "Híbrido"
        else:
            modalidade = "Presencial"

        desc_limpa = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", j.get("description") or "")).strip()[:280]
        jobs.append({
            "empresa": empresa,
            "cargo": cargo,
            "modalidade": modalidade,
            "localizacao": f"{j.get('city') or cidade_padrao}/{j.get('state') or uf_padrao}",
            "turno": "Tarde / Flexível",
            "prazo": "Inscrições Abertas",
            "requisitos": desc_limpa or "Estágio em Tecnologia / Desenvolvimento (Catho)",
            "link": link,
            "fonte": "catho",
        })

    return {
        "source": "catho",
        "ok": True,
        "jobs": jobs,
        "durationMs": int((time.monotonic() - t0) * 1000),
        "error": None,
    }
