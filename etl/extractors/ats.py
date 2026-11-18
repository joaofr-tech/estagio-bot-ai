from __future__ import annotations

import json
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import quote

from .http_client import fetch_with_retry

GREENHOUSE_BOARDS = [
    {"slug": "ifoodcarreiras", "empresa": "iFood"},
    {"slug": "vtex", "empresa": "VTEX"},
    {"slug": "incognia-conf", "empresa": "Incognia"},
    {"slug": "artefactjobs", "empresa": "Artefact"},
]

INHIRE_TENANTS = [
    {"slug": "radix", "empresa": "Radix"},
    {"slug": "elogroup", "empresa": "EloGroup"},
    {"slug": "atlantico", "empresa": "Instituto Atlântico"},
    {"slug": "nuvidio", "empresa": "Nuvidio"},
]


def _normalizar_sem_acento(texto: str | None) -> str:
    nfd = unicodedata.normalize("NFD", (texto or "").lower())
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn").strip()


def _slugify(texto: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "-", _normalizar_sem_acento(texto)).strip("-")


def is_estagio_tech(cargo: str) -> bool:
    norm = _normalizar_sem_acento(cargo)
    bloqueados = (
        "suporte", "helpdesk", "comercial", "vendas", "sdr", "juridico",
        "direito", "rh", "recursos humanos", "financeiro", "contabil", "marketing",
    )
    if any(b in norm for b in bloqueados):
        return False

    tem_estagio = bool(re.search(r"\b(estag|intern|estagiario|estagiaria)\b", norm) or "estagi" in norm)
    if not tem_estagio:
        return False

    return bool(
        re.search(
            r"(\b(dev|ai|ia|ti|qa)\b|software|desenvolv|dados|data|analytics|"
            r"inteligencia artificial|engenharia|engineering|tecnologia|sistemas|"
            r"backend|frontend|full ?stack|mobile|qualidade|cloud|produto|product|computacao)",
            norm,
        )
    )


def _inferir_modalidade(workplace_type: str, location_str: str, cargo: str) -> str:
    texto = _normalizar_sem_acento(f"{workplace_type} {location_str} {cargo}")
    if "remote" in texto or "remoto" in texto or "home office" in texto:
        return "Remoto"
    if "hybrid" in texto or "hibrido" in texto:
        return "Híbrido"
    return "Presencial"


def _is_local_compativel(modalidade: str, location_str: str, config: dict[str, Any]) -> bool:
    norm_loc = _normalizar_sem_acento(location_str)
    estrangeiros = (
        "united states", "estados unidos", "usa", "mexico", "colombia",
        "argentina", "chile", "peru", "europe", "portugal", "spain", "uk", "singapore",
    )
    if any(t in norm_loc for t in estrangeiros):
        if "brasil" not in norm_loc and "brazil" not in norm_loc and "belo horizonte" not in norm_loc:
            return False

    if modalidade == "Remoto":
        return config.get("aceitaRemoto", True) is not False

    cidades_cfg = config.get("cidades")
    cidades = (
        [_normalizar_sem_acento(c) for c in cidades_cfg]
        if isinstance(cidades_cfg, list) and cidades_cfg
        else ["belo horizonte", "contagem", "betim", "nova lima", "ibirite"]
    )
    if any(c in norm_loc for c in cidades):
        return True
    if "minas gerais" in norm_loc or re.search(r"\bmg\b", norm_loc):
        return True
    if norm_loc in ("br", "brasil", "brazil") and config.get("aceitaRemoto", True) is not False:
        return True
    return False


def _fetch_greenhouse_board(board: dict[str, str], config: dict[str, Any]) -> dict[str, Any]:
    url = f"https://boards-api.greenhouse.io/v1/boards/{quote(board['slug'])}/jobs"
    resp = fetch_with_retry(url, headers={"Accept": "application/json"}, retries=1, timeout=8.0)
    if not resp.ok:
        return {"ok": False, "jobs": [], "error": resp.error}

    try:
        data = json.loads(resp.body)
    except Exception:
        return {"ok": False, "jobs": [], "error": "JSON inválido Greenhouse"}

    jobs: list[dict[str, Any]] = []
    for j in data.get("jobs", []) or []:
        cargo = (j.get("title") or "").strip()
        if not is_estagio_tech(cargo):
            continue
        loc_str = ((j.get("location") or {}).get("name") or "Brasil").strip()
        modalidade = _inferir_modalidade("", loc_str, cargo)
        if not _is_local_compativel(modalidade, loc_str, config):
            continue
        abs_url = (j.get("absolute_url") or "").strip()
        if not abs_url:
            continue
        jobs.append({
            "empresa": board["empresa"],
            "cargo": cargo,
            "modalidade": modalidade,
            "localizacao": loc_str,
            "turno": "Tarde / Flexível",
            "prazo": "Inscrições Abertas",
            "requisitos": f"Estágio via Greenhouse ({board['empresa']})",
            "link": abs_url,
            "fonte": "greenhouse",
        })
    return {"ok": True, "jobs": jobs, "error": None}


def _fetch_inhire_tenant(tenant: dict[str, str], config: dict[str, Any]) -> dict[str, Any]:
    slug = tenant["slug"]
    url = "https://api.inhire.app/job-posts/public/pages"
    resp = fetch_with_retry(
        url,
        headers={
            "Accept": "application/json",
            "X-Tenant": slug,
            "Origin": f"https://{slug}.inhire.app",
        },
        retries=1,
        timeout=8.0,
    )
    if not resp.ok:
        return {"ok": False, "jobs": [], "error": resp.error}

    try:
        data = json.loads(resp.body)
    except Exception:
        return {"ok": False, "jobs": [], "error": "JSON inválido InHire"}

    jobs: list[dict[str, Any]] = []
    empresa_nome = (data.get("tenantName") or tenant["empresa"] or slug).strip()
    for j in data.get("jobsPage", []) or []:
        if j.get("status") and j["status"] != "published":
            continue
        cargo = (j.get("displayName") or "").strip()
        if not is_estagio_tech(cargo):
            continue
        loc_str = (j.get("location") or "Brasil").strip()
        modalidade = _inferir_modalidade(j.get("workplaceType") or "", loc_str, cargo)
        if not _is_local_compativel(modalidade, loc_str, config):
            continue
        job_id = j.get("jobId")
        if not job_id:
            continue
        slug_cargo = _slugify(cargo) or "vaga"
        jobs.append({
            "empresa": empresa_nome,
            "cargo": cargo,
            "modalidade": modalidade,
            "localizacao": "Remoto - Brasil" if modalidade == "Remoto" else loc_str,
            "turno": "Tarde / Flexível",
            "prazo": "Inscrições Abertas",
            "requisitos": f"Estágio via InHire ({empresa_nome})",
            "link": f"https://{slug}.inhire.app/vagas/{job_id}/{slug_cargo}",
            "fonte": "inhire",
        })
    return {"ok": True, "jobs": jobs, "error": None}


def extract(config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Extrai vagas diretamente das APIs públicas do Greenhouse e InHire."""
    config = config or {}
    t0 = time.monotonic()

    tasks: list[tuple[Any, dict[str, str]]] = [
        (_fetch_greenhouse_board, b) for b in GREENHOUSE_BOARDS
    ] + [
        (_fetch_inhire_tenant, t) for t in INHIRE_TENANTS
    ]

    jobs: list[dict[str, Any]] = []
    seen_links: set[str] = set()
    ok_count = 0
    last_err: str | None = None

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(fn, item, config) for fn, item in tasks]
        for fut in futures:
            try:
                res = fut.result()
                if res.get("ok"):
                    ok_count += 1
                    for j in res.get("jobs", []):
                        k = j["link"].lower()
                        if k not in seen_links:
                            seen_links.add(k)
                            jobs.append(j)
                elif res.get("error"):
                    last_err = res["error"]
            except Exception as exc:
                last_err = str(exc)

    ok = ok_count > 0
    return {
        "source": "ats_greenhouse_inhire",
        "ok": ok,
        "jobs": jobs,
        "durationMs": int((time.monotonic() - t0) * 1000),
        "error": None if ok else (last_err or "Falha ao consultar boards Greenhouse/InHire"),
    }
