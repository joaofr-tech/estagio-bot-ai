from __future__ import annotations

import json
import random
import re
import string
import time
import unicodedata
from dataclasses import dataclass, field
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

PASS, REVIEW, REJECT = "pass", "review", "reject"

# Detecção de negação em janela anterior ao termo (PT-BR + EN, inspirado em job-hunt-agent/screen.py)
NEGATION_RE = re.compile(
    r"\b(nao|sem|nenhum|nenhuma|dispensa|dispensado|isento de|livre de|exceto|"
    r"no|not|non|without|never|zero|nor|free of)\b[\w\s,/-]{0,24}$",
    re.IGNORECASE,
)


@dataclass
class ScreenHit:
    term: str
    kind: str
    snippets: list[str] = field(default_factory=list)


@dataclass
class ScreenResult:
    verdict: str
    hits: list[ScreenHit] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict,
            "hits": [{"term": h.term, "kind": h.kind, "snippets": h.snippets} for h in self.hits],
        }


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


def _compile_screen_term(term: str) -> re.Pattern[str] | None:
    """Compila termo com suporte a wildcard `*` no sufixo e fronteiras de palavra."""
    norm = _normalizar_para_mismatch(term.rstrip("*"))
    if not norm:
        return None
    stem = term.strip().endswith("*")
    words = [re.escape(w) for w in norm.split() if w]
    if not words:
        return None
    body = r"[\s\-]+".join(words)
    prefix = r"\b" if norm[0].isalnum() else ""
    suffix = "" if stem or not norm[-1].isalnum() else r"\b"
    return re.compile(prefix + body + suffix, re.IGNORECASE)


def _extract_snippet(text: str, start: int, end: int, radius: int = 70) -> str:
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    chunk = text[left:right].replace("\n", " ")
    return f"{'…' if left else ''}{chunk.strip()}{'…' if right < len(text) else ''}"


def _is_negated(norm_text: str, start: int) -> bool:
    window = norm_text[max(0, start - 36) : start]
    return bool(NEGATION_RE.search(window))


def _find_screen_hits(
    raw_text: str,
    norm_text: str,
    terms: list[str],
    kind: str,
    limit: int = 3,
) -> list[ScreenHit]:
    hits: list[ScreenHit] = []
    for term in terms or []:
        pattern = _compile_screen_term(term)
        if not pattern:
            continue
        matches = list(pattern.finditer(norm_text))
        if not matches:
            continue
        plain = [m for m in matches if not _is_negated(norm_text, m.start())]
        if kind == REJECT and not plain:
            # Termo de rejeição apareceu apenas negado (ex: "não é suporte técnico") → rebaixa para revisão
            hits.append(
                ScreenHit(
                    term=f"{term} (negado, confirmar)",
                    kind=REVIEW,
                    snippets=[_extract_snippet(norm_text, m.start(), m.end()) for m in matches[:limit]],
                )
            )
        else:
            chosen = plain or matches
            hits.append(
                ScreenHit(
                    term=term,
                    kind=kind,
                    snippets=[_extract_snippet(norm_text, m.start(), m.end()) for m in chosen[:limit]],
                )
            )
    return hits


def carregar_regras_mismatch(regras_path: Path = REGRAS_MISMATCH_PATH) -> dict[str, Any]:
    if not regras_path.exists():
        return {
            "termosNegativos": ["suporte técnico", "helpdesk", "service desk", "telemarketing", "sdr", "vendas"],
            "termosAlerta": ["plantão", "sobreaviso", "on-call", "banco de talentos", "pj"],
            "regrasExclusao": [],
        }
    try:
        data = json.loads(regras_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"termosNegativos": [], "termosAlerta": []}
    except Exception:
        return {"termosNegativos": [], "termosAlerta": []}


def avaliar_screening(
    texto: str,
    regras_mismatch: dict[str, Any] | None = None,
) -> ScreenResult:
    """Avalia uma vaga em 3 níveis (pass | review | reject) com detecção de negação e snippets."""
    regras = regras_mismatch if regras_mismatch is not None else carregar_regras_mismatch()
    norm = _normalizar_para_mismatch(texto)
    reject_terms = list(regras.get("termosNegativos", []) or [])
    warn_terms = list(regras.get("termosAlerta", []) or [])

    hits = _find_screen_hits(texto, norm, reject_terms, REJECT) + _find_screen_hits(texto, norm, warn_terms, REVIEW)
    kinds = {h.kind for h in hits}
    verdict = REJECT if REJECT in kinds else REVIEW if REVIEW in kinds else PASS
    return ScreenResult(verdict=verdict, hits=sorted(hits, key=lambda h: h.kind != REJECT))


def verificar_termo_proibido(
    texto: str,
    regras_mismatch: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Verifica termos proibidos com suporte a negação, mantendo compatibilidade com contrato anterior."""
    result = avaliar_screening(texto, regras_mismatch)
    if result.verdict == REJECT:
        first_reject = next((h for h in result.hits if h.kind == REJECT), result.hits[0])
        return {
            "proibido": True,
            "termo": first_reject.term,
            "veredito": REJECT,
            "snippets": first_reject.snippets,
            "hits": result.to_dict()["hits"],
        }
    if result.verdict == REVIEW:
        return {
            "proibido": False,
            "veredito": REVIEW,
            "alertas": [h.term for h in result.hits],
            "hits": result.to_dict()["hits"],
        }
    return {"proibido": False, "veredito": PASS, "hits": []}


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
    - Aplica triagem inteligente (reject / review / pass) com detecção de negação
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
        if checagem.get("veredito") == REVIEW:
            funil.alertasRevisao += 1

        ineditas.append(vaga)
        funil.ineditas += 1

    return ineditas, funil
