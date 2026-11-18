from __future__ import annotations

import json
import random
import re
import string
import time
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .models import FunnelMetrics, VagaRecord

ROOT_DIR = Path(__file__).resolve().parent.parent
REGRAS_MISMATCH_PATH = ROOT_DIR / "regras_mismatch.json"

STOP_WORDS_RE = re.compile(
    r"\b(de|do|da|dos|das|em|para|com|e|bh|mg|remoto|hibrido|estagio|estagiario|estagiaria)\b"
)
PONTUACAO_RE = re.compile(r"[\[\]\(\)\-\_\,\.\:\/\+\&\|\!\?\#\@]")


def _strip_accents(texto: str | None) -> str:
    nfd = unicodedata.normalize("NFD", (texto or "").lower())
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")


def normalizar_texto(texto: str | None) -> str:
    """Normaliza strings removendo acentos, pontuações e stop-words para deduplicação canônica."""
    sem_acento = _strip_accents(texto)
    sem_pontuacao = PONTUACAO_RE.sub(" ", sem_acento)
    sem_stopwords = STOP_WORDS_RE.sub(" ", sem_pontuacao)
    return re.sub(r"\s+", " ", sem_stopwords).strip()


def gerar_chave_canonica(empresa: str | None, cargo: str | None) -> str:
    return f"{normalizar_texto(empresa)}::{normalizar_texto(cargo)}"


def _normalizar_para_mismatch(texto: str | None) -> str:
    sem_acento = _strip_accents(texto)
    sem_pontuacao = PONTUACAO_RE.sub(" ", sem_acento)
    return re.sub(r"\s+", " ", sem_pontuacao).strip()


def carregar_regras_mismatch(regras_path: Path = REGRAS_MISMATCH_PATH) -> dict[str, Any]:
    if not regras_path.exists():
        return {
            "termosNegativos": ["suporte técnico", "helpdesk", "service desk", "telemarketing", "sdr", "vendas"],
            "regrasExclusao": [],
        }
    try:
        data = json.loads(regras_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"termosNegativos": []}
    except Exception:
        return {"termosNegativos": []}


def verificar_termo_proibido(
    texto: str,
    regras_mismatch: dict[str, Any] | None = None,
) -> dict[str, Any]:
    regras = regras_mismatch if regras_mismatch is not None else carregar_regras_mismatch()
    normal = _normalizar_para_mismatch(texto)
    for termo in regras.get("termosNegativos", []) or []:
        termo_norm = _normalizar_para_mismatch(termo)
        if termo_norm and termo_norm in normal:
            return {"proibido": True, "termo": termo}
    return {"proibido": False}


def _gerar_id_vaga() -> str:
    sufixo = "".join(random.choices(string.ascii_lowercase + string.digits, k=5))
    return f"vaga-{int(time.time() * 1000)}-{sufixo}"


def filtrar_e_transformar(
    raw_jobs: list[dict[str, Any]],
    vagas_existentes: list[dict[str, Any]] | None = None,
    regras_mismatch: dict[str, Any] | None = None,
) -> tuple[list[VagaRecord], FunnelMetrics]:
    """
    Etapa Transform do ETL:
    - Valida contrato de dados com Pydantic v2 (VagaRecord)
    - Deduplica dentro da rodada e contra a base existente (Supabase/local)
    - Aplica filtro preventivo de mismatch
    """
    lista_bruta = raw_jobs if isinstance(raw_jobs, list) else []
    existentes = vagas_existentes if isinstance(vagas_existentes, list) else []
    regras = regras_mismatch if regras_mismatch is not None else carregar_regras_mismatch()

    chaves_banco: set[str] = set()
    links_banco: set[str] = set()
    for v in existentes:
        chaves_banco.add(gerar_chave_canonica(v.get("empresa"), v.get("cargo")))
        link = (v.get("link") or "").strip().lower()
        if link:
            links_banco.add(link)

    chaves_rodada: set[str] = set()
    links_rodada: set[str] = set()
    ineditas: list[VagaRecord] = []

    funil = FunnelMetrics(extraidas=len(lista_bruta))
    agora_str = datetime.now().strftime("%d/%m/%Y, %H:%M:%S")

    for raw in lista_bruta:
        if not isinstance(raw, dict):
            funil.invalidas += 1
            continue

        payload = dict(raw)
        if not payload.get("id"):
            payload["id"] = _gerar_id_vaga()
        if not payload.get("data_coleta"):
            payload["data_coleta"] = payload.get("dataColeta") or agora_str

        try:
            vaga = VagaRecord(**payload)
        except ValidationError:
            funil.invalidas += 1
            continue

        chave = gerar_chave_canonica(vaga.empresa, vaga.cargo)
        link_norm = vaga.link.lower() if vaga.link else ""

        if chave in chaves_rodada or (link_norm and link_norm in links_rodada):
            funil.duplicadasRodada += 1
            continue

        chaves_rodada.add(chave)
        if link_norm:
            links_rodada.add(link_norm)

        if chave in chaves_banco or (link_norm and link_norm in links_banco):
            funil.jaConhecidas += 1
            continue

        checagem = verificar_termo_proibido(f"{vaga.cargo} {vaga.requisitos}", regras)
        if checagem.get("proibido"):
            funil.filtradasMismatch += 1
            continue

        ineditas.append(vaga)
        funil.ineditas += 1

    return ineditas, funil
