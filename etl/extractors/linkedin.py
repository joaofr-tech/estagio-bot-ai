from __future__ import annotations

import html as html_lib
import re
import time
import unicodedata
from typing import Any
from urllib.parse import quote

from .http_client import fetch_with_retry


def _normalizar_sem_acento(texto: str | None) -> str:
    nfd = unicodedata.normalize("NFD", (texto or "").lower())
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn").strip()


def _limpar_html(texto: str) -> str:
    sem_tags = re.sub(r"<[^>]+>", "", texto)
    return re.sub(r"\s+", " ", html_lib.unescape(sem_tags)).strip()


def parse_linkedin_cards(html: str) -> list[dict[str, str]]:
    jobs: list[dict[str, str]] = []
    cards = re.split(r'<li>\s*<div[^>]*class="[^"]*base-card', html, flags=re.IGNORECASE)[1:]

    for card in cards:
        id_match = re.search(r"jobPosting:(\d+)", card)
        if not id_match:
            continue
        job_id = id_match.group(1)

        title_match = re.search(r'<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)</h3>', card, re.I)
        company_match = (
            re.search(r'<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)</a>', card, re.I)
            or re.search(r'<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)</h4>', card, re.I)
        )
        location_match = re.search(r'<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)</span>', card, re.I)

        cargo = _limpar_html(title_match.group(1)) if title_match else ""
        empresa = _limpar_html(company_match.group(1)) if company_match else ""
        localizacao = _limpar_html(location_match.group(1)) if location_match else ""

        if not cargo and not empresa:
            continue

        jobs.append({
            "id": job_id,
            "empresa": empresa or "Empresa Confidencial",
            "cargo": cargo or "Estágio TI",
            "localizacao": localizacao or "Belo Horizonte / MG",
            "link": f"https://www.linkedin.com/jobs/view/{job_id}/",
        })

    return jobs


def _inferir_modalidade(cargo: str, localizacao: str) -> str:
    texto = _normalizar_sem_acento(f"{cargo} {localizacao}")
    if "remoto" in texto or "remote" in texto or "home office" in texto:
        return "Remoto"
    if "hibrido" in texto or "hybrid" in texto:
        return "Híbrido"
    return "Presencial"


def is_localizacao_valida(localizacao: str, config: dict[str, Any] | None = None) -> bool:
    config = config or {}
    norm = _normalizar_sem_acento(localizacao)
    if not norm:
        return False

    termos_estrangeiros = (
        "estados unidos", "united states", "california", "texas", "washington",
        "seattle", "austin", "long beach", "new york", "florida", "canada",
        "united kingdom", "alemanha", "germany", "portugal", "espanha", "franca", "india",
    )
    if any(t in norm for t in termos_estrangeiros):
        return False

    cidades_cfg = config.get("cidades")
    cidades_alvo = (
        [_normalizar_sem_acento(c) for c in cidades_cfg]
        if isinstance(cidades_cfg, list) and cidades_cfg
        else ["belo horizonte", "contagem", "betim", "nova lima", "ibirite"]
    )
    estado_alvo = _normalizar_sem_acento(config.get("estado") or "MG")

    if any(c in norm for c in cidades_alvo):
        return True
    if "minas gerais" in norm or re.search(rf"\b{re.escape(estado_alvo)}\b", norm):
        return True

    if config.get("aceitaRemoto", True):
        if re.search(r"\b(brasil|brazil|sp|rj|pr|sc|rs|df|go|ba|pe|ce|es)\b", norm):
            return True

    return False


def is_vaga_tech_estagio(cargo: str) -> bool:
    norm = _normalizar_sem_acento(cargo)
    termos_bloqueados = (
        "suporte", "helpdesk", "help desk", "infraestrutura",
        "nivel medio", "comercial", "producao", "consultoria e gestao",
    )
    if any(t in norm for t in termos_bloqueados):
        return False

    tem_estagio = bool(re.search(r"\b(estag|intern|trainee)\b", norm) or "estagi" in norm)
    tem_tech = bool(
        re.search(
            r"(\b(dev|ia|ti|qa)\b|software|desenvolv|dados|data|analytics|"
            r"inteligencia artificial|sistemas|programacao|computacao|tecnologia|"
            r"backend|frontend|full ?stack|mobile|cloud|engenharia)",
            norm,
        )
    )
    return tem_estagio and tem_tech


def extract(config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Extrai vagas de estágio em TI da Guest API pública do LinkedIn."""
    config = config or {}
    t0 = time.monotonic()
    cidades = config.get("cidades") or ["Belo Horizonte"]
    cidade_base = cidades[0] if isinstance(cidades, list) and cidades else "Belo Horizonte"

    termos = ["estagio ti", "estagio engenharia software", "estagio dados"]
    urls = [
        f"https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={quote(t)}&location={quote(cidade_base)}&f_TPR=r604800&start=0"
        for t in termos
    ]
    if config.get("aceitaRemoto", True):
        urls.append(
            f"https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={quote('estagio desenvolvimento software')}&geoId=106057199&f_WT=2&f_TPR=r604800&start=0"
        )

    por_id: dict[str, dict[str, Any]] = {}
    requisicoes_ok = 0
    ultimo_erro: str | None = None

    for url in urls:
        resp = fetch_with_retry(url, retries=2, timeout=10.0)
        if resp.ok:
            requisicoes_ok += 1
            for item in parse_linkedin_cards(resp.body):
                if not is_vaga_tech_estagio(item["cargo"]):
                    continue
                if not is_localizacao_valida(item["localizacao"], config):
                    continue
                if item["id"] not in por_id:
                    por_id[item["id"]] = {
                        "empresa": item["empresa"],
                        "cargo": item["cargo"],
                        "modalidade": _inferir_modalidade(item["cargo"], item["localizacao"]),
                        "localizacao": item["localizacao"],
                        "turno": "Tarde / Flexível",
                        "prazo": "Inscrições Abertas",
                        "requisitos": "Estágio em Tecnologia / Desenvolvimento",
                        "link": item["link"],
                        "fonte": "linkedin",
                    }
        else:
            ultimo_erro = resp.error or f"HTTP {resp.status_code}"

    ok = requisicoes_ok > 0
    return {
        "source": "linkedin",
        "ok": ok,
        "jobs": list(por_id.values()),
        "durationMs": int((time.monotonic() - t0) * 1000),
        "error": None if ok else (ultimo_erro or "Falha em todas as consultas LinkedIn"),
    }
