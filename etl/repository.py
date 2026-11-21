from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

from .models import PipelineRunTelemetry, VagaRecord

ROOT_DIR = Path(__file__).resolve().parent.parent
BANCO_PATH = ROOT_DIR / "banco_vagas.json"
BANCO_JS_PATH = ROOT_DIR / "banco_vagas.js"
HISTORICO_JS_PATH = ROOT_DIR / "historico_execucoes.js"

load_dotenv(ROOT_DIR / ".env")


def write_file_atomically(file_path: str | Path, content: str) -> None:
    """Grava arquivo de forma atômica usando arquivo temporário + os.replace."""
    target = Path(file_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target.with_name(f"{target.name}.{os.getpid()}.tmp")
    try:
        tmp_path.write_text(content, encoding="utf-8")
        try:
            os.replace(tmp_path, target)
        except PermissionError:
            target.write_text(content, encoding="utf-8")
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def _get_supabase_config() -> tuple[str | None, str | None]:
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    return (url or None, key or None)


def _supabase_headers(key: str, extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if extra:
        headers.update(extra)
    return headers


def carregar_banco_local(banco_path: Path = BANCO_PATH) -> list[dict[str, Any]]:
    if not banco_path.exists():
        return []
    try:
        data = json.loads(banco_path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def salvar_banco_local(
    banco: list[dict[str, Any]],
    banco_path: Path = BANCO_PATH,
    banco_js_path: Path = BANCO_JS_PATH,
) -> None:
    json_str = json.dumps(banco, indent=2, ensure_ascii=False)
    write_file_atomically(banco_path, json_str)
    write_file_atomically(banco_js_path, f"window.BANCO_VAGAS = {json_str};\n")


def _iso_to_ms(iso_str: str | None) -> int:
    if not iso_str:
        return 0
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except Exception:
        return 0


def _require_supabase_config() -> tuple[str, str]:
    url, key = _get_supabase_config()
    if not url or not key:
        raise RuntimeError(
            "Credenciais Supabase obrigatórias ausentes: configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."
        )
    return url, key


def carregar_vagas_atuais(
    skip_network: bool = False,
    require_cloud: bool = False,
) -> tuple[list[dict[str, Any]], str]:
    """
    Carrega vagas com Supabase PostgreSQL como Fonte Única da Verdade.
    Faz fallback seguro para o cache local banco_vagas.json se offline ou sem credenciais,
    exceto quando require_cloud=True (modo fail-fast para CI/nuvem).
    Retorna (lista_vagas, origem: 'supabase' | 'local').
    """
    local_list = carregar_banco_local()
    local_audit_by_id = {
        v.get("id"): v.get("ultimaAuditoriaMs", 0)
        for v in local_list
        if isinstance(v, dict) and v.get("id")
    }

    if require_cloud:
        url, key = _require_supabase_config()
    else:
        url, key = _get_supabase_config()

    if not skip_network and url and key:
        try:
            endpoint = f"{url}/rest/v1/vagas?select=*&order=created_at.desc&limit=5000"
            with httpx.Client(timeout=15.0) as client:
                resp = client.get(endpoint, headers=_supabase_headers(key))
            if resp.status_code == 200:
                rows = resp.json()
                if isinstance(rows, list):
                    normalized: list[dict[str, Any]] = []
                    for r in rows:
                        vid = r.get("id", "")
                        audit_ms = local_audit_by_id.get(vid) or _iso_to_ms(r.get("updated_at")) or _iso_to_ms(r.get("created_at"))
                        normalized.append({
                            "id": vid,
                            "empresa": r.get("empresa") or "",
                            "cargo": r.get("cargo") or "",
                            "modalidade": r.get("modalidade") or "",
                            "localizacao": r.get("localizacao") or "",
                            "turno": r.get("turno") or "",
                            "prazo": r.get("prazo") or "",
                            "requisitos": r.get("requisitos") or "",
                            "link": r.get("link") or "",
                            "dataColeta": r.get("data_coleta") or "",
                            "notificada": bool(r.get("notificada", False)),
                            "status": r.get("status") or "para_aplicar",
                            "updated_at": r.get("updated_at"),
                            "created_at": r.get("created_at"),
                            "ultimaAuditoriaMs": audit_ms,
                        })
                    return normalized, "supabase"
            msg = f"[Supabase] Erro ao consultar vagas HTTP {resp.status_code}: {resp.text[:250]}"
            if require_cloud:
                raise RuntimeError(msg)
            print(f"{msg}; usando cache local.")
        except RuntimeError:
            raise
        except Exception as exc:
            if require_cloud:
                raise RuntimeError(f"[Supabase] Falha obrigatória ao consultar vagas: {exc}") from exc
            print(f"[Supabase] Aviso ao consultar vagas ({exc}); usando cache local.")

    if require_cloud:
        raise RuntimeError("[Supabase] Não foi possível carregar vagas da nuvem com --require-cloud ativo.")

    return local_list, "local"


def _to_supabase_row(v: dict[str, Any], include_updated_at: bool = False) -> dict[str, Any]:
    row = {
        "id": v.get("id", ""),
        "empresa": v.get("empresa", ""),
        "cargo": v.get("cargo", ""),
        "modalidade": v.get("modalidade"),
        "localizacao": v.get("localizacao"),
        "turno": v.get("turno"),
        "prazo": v.get("prazo"),
        "requisitos": v.get("requisitos"),
        "link": v.get("link", ""),
        "data_coleta": v.get("dataColeta") or v.get("data_coleta"),
        "notificada": bool(v.get("notificada", False)),
        "status": v.get("status") or "para_aplicar",
    }
    if include_updated_at:
        row["updated_at"] = datetime.now(timezone.utc).isoformat()
    return row


def _deduplicar_por_link(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Garante unicidade por `link` dentro do mesmo lote para evitar erro ON CONFLICT no PostgreSQL."""
    unicos: dict[str, dict[str, Any]] = {}
    for row in rows:
        link_norm = (row.get("link") or "").strip().lower()
        if link_norm:
            unicos[link_norm] = row
    return list(unicos.values())


def upsert_vagas(
    novas_vagas: list[VagaRecord],
    banco_atual: list[dict[str, Any]] | None = None,
    skip_network: bool = False,
    require_cloud: bool = False,
) -> bool:
    """
    Persiste novas vagas no PostgreSQL (Supabase) via UPSERT por `link`
    e atualiza o cache local atomicamente.
    """
    if not novas_vagas:
        return True

    if require_cloud:
        url, key = _require_supabase_config()
    else:
        url, key = _get_supabase_config()

    # Atualizar cache local (mantendo mais recentes no topo)
    base_local = list(banco_atual) if banco_atual is not None else carregar_banco_local()
    links_existentes = {(v.get("link") or "").strip().lower() for v in base_local if v.get("link")}
    novas_dicts = [v.to_local_dict() for v in novas_vagas]

    novos_para_local = [
        d for d in novas_dicts
        if not d.get("link") or d["link"].strip().lower() not in links_existentes
    ]
    if novos_para_local:
        banco_atualizado = novos_para_local + base_local
        salvar_banco_local(banco_atualizado)

    if skip_network or not url or not key:
        if require_cloud:
            raise RuntimeError("[Supabase] Persistência obrigatória ignorada (skip_network ou credenciais ausentes).")
        return False

    payload_com_link = _deduplicar_por_link([v.to_supabase_dict() for v in novas_vagas if v.link])
    if not payload_com_link:
        return False

    try:
        endpoint = f"{url}/rest/v1/vagas?on_conflict=link"
        headers = _supabase_headers(key, {"Prefer": "resolution=merge-duplicates"})
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(endpoint, headers=headers, json=payload_com_link)
        if resp.status_code in (200, 201, 204):
            print(f"[Supabase] ☁️ {len(payload_com_link)} vaga(s) sincronizada(s) no PostgreSQL!")
            return True
        msg = f"[Supabase] Erro UPSERT HTTP {resp.status_code}: {resp.text[:250]}"
        if require_cloud:
            raise RuntimeError(msg)
        print(msg)
        return False
    except RuntimeError:
        raise
    except Exception as exc:
        if require_cloud:
            raise RuntimeError(f"[Supabase] Falha de conexão ao salvar vagas: {exc}") from exc
        print(f"[Supabase] Falha de conexão ao salvar vagas: {exc}")
        return False


def atualizar_status_vagas(
    vagas_atualizadas: list[dict[str, Any]],
    banco_completo: list[dict[str, Any]] | None = None,
    skip_network: bool = False,
    require_cloud: bool = False,
) -> bool:
    """
    Atualiza status / notificada / updated_at de vagas existentes no Supabase e no cache local.
    """
    if banco_completo is not None:
        salvar_banco_local(banco_completo)
    elif vagas_atualizadas:
        local = carregar_banco_local()
        por_id = {v.get("id"): v for v in vagas_atualizadas if v.get("id")}
        por_link = {(v.get("link") or "").strip().lower(): v for v in vagas_atualizadas if v.get("link")}
        alterou = False
        for idx, item in enumerate(local):
            match = por_id.get(item.get("id")) or por_link.get((item.get("link") or "").strip().lower())
            if match:
                local[idx] = {**item, **match}
                alterou = True
        if alterou:
            salvar_banco_local(local)

    if not vagas_atualizadas or skip_network:
        return False

    if require_cloud:
        url, key = _require_supabase_config()
    else:
        url, key = _get_supabase_config()
    if not url or not key:
        return False

    com_link = _deduplicar_por_link([_to_supabase_row(v, include_updated_at=True) for v in vagas_atualizadas if v.get("link")])
    if not com_link:
        return False

    try:
        endpoint = f"{url}/rest/v1/vagas?on_conflict=link"
        headers = _supabase_headers(key, {"Prefer": "resolution=merge-duplicates"})
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(endpoint, headers=headers, json=com_link)
        if resp.status_code in (200, 201, 204):
            return True
        msg = f"[Supabase] Erro ao atualizar status HTTP {resp.status_code}: {resp.text[:250]}"
        if require_cloud:
            raise RuntimeError(msg)
        print(msg)
        return False
    except RuntimeError:
        raise
    except Exception as exc:
        if require_cloud:
            raise RuntimeError(f"[Supabase] Falha ao atualizar status na nuvem: {exc}") from exc
        print(f"[Supabase] Falha ao atualizar status na nuvem: {exc}")
        return False


def ler_historico_execucoes(js_path: Path = HISTORICO_JS_PATH) -> list[dict[str, Any]]:
    if not js_path.exists():
        return []
    try:
        raw = js_path.read_text(encoding="utf-8")
        marker = "window.HISTORICO_EXECUCOES"
        marker_idx = raw.find(marker)
        start_idx = raw.find("[", marker_idx) if marker_idx != -1 else raw.find("[")
        end_idx = raw.rfind("]")
        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
            parsed = json.loads(raw[start_idx : end_idx + 1])
            return parsed if isinstance(parsed, list) else []
    except Exception as exc:
        print(f"[Observabilidade] Aviso ao ler histórico local: {exc}")
    return []


def detectar_zero_yield_fontes(historico: list[dict[str, Any]], limite_rodadas: int = 3) -> list[str]:
    if not isinstance(historico, list):
        return []
    com_fontes = [h for h in historico if isinstance(h, dict) and isinstance(h.get("fontes"), dict)]
    if len(com_fontes) < limite_rodadas:
        return []

    janela = com_fontes[:limite_rodadas]
    nomes_fontes: set[str] = set()
    for run in janela:
        nomes_fontes.update(run["fontes"].keys())

    avisos: list[str] = []
    for fonte in sorted(nomes_fontes):
        todas_sem_retorno = True
        for run in janela:
            f = run["fontes"].get(fonte)
            if not f or f.get("status") == "skipped":
                todas_sem_retorno = False
                break
            if not (f.get("status") == "error" or (f.get("brutas") or 0) == 0):
                todas_sem_retorno = False
                break
        if todas_sem_retorno:
            avisos.append(f"Fonte '{fonte}' sem retorno há {limite_rodadas} rodadas")
    return avisos


def registrar_telemetria(
    telemetria: PipelineRunTelemetry,
    historico_local_path: Path = HISTORICO_JS_PATH,
    skip_network: bool = False,
    require_cloud: bool = False,
) -> dict[str, Any]:
    """Registra telemetria estruturada no Supabase (historico_execucoes) e no bridge JS local."""
    historico = ler_historico_execucoes(historico_local_path)
    nova_entrada = telemetria.model_dump()
    historico.insert(0, nova_entrada)
    if len(historico) > 50:
        historico = historico[:50]

    falhas_consecutivas = 0
    for h in historico:
        if h.get("isErro") or h.get("status") == "ERRO_CRAWLER":
            falhas_consecutivas += 1
        else:
            break

    avisos_fontes = detectar_zero_yield_fontes(historico, 3)

    health_status = "healthy"
    health_msg = "Pipeline Python ETL operando normalmente."
    if nova_entrada.get("isErro") or falhas_consecutivas > 0:
        health_status = "critical" if falhas_consecutivas >= 3 else "warning"
        health_msg = f"Falha detectada na varredura ({telemetria.mensagem})."
    elif avisos_fontes:
        health_status = "warning"
        health_msg = " | ".join(avisos_fontes)

    health_data = {
        "status": health_status,
        "ultimaExecucao": telemetria.timestamp,
        "ultimoStatus": telemetria.status,
        "duracaoSegundos": telemetria.duracaoSegundos,
        "falhasConsecutivas": falhas_consecutivas,
        "avisosFontes": avisos_fontes,
        "mensagem": health_msg,
    }

    output_content = (
        f"window.CRAWLER_HEALTH = {json.dumps(health_data, indent=2, ensure_ascii=False)};\n"
        f"window.HISTORICO_EXECUCOES = {json.dumps(historico, indent=2, ensure_ascii=False)};\n"
    )
    write_file_atomically(historico_local_path, output_content)

    if require_cloud:
        url, key = _require_supabase_config()
    else:
        url, key = _get_supabase_config()

    if not skip_network and url and key:
        try:
            endpoint = f"{url}/rest/v1/historico_execucoes"
            payload = {
                "timestamp": telemetria.timestamp,
                "status": telemetria.status,
                "is_erro": bool(telemetria.isErro),
                "duracao_segundos": telemetria.duracaoSegundos,
                "mensagem": telemetria.mensagem,
                "total_vagas": len(telemetria.vagas),
            }
            with httpx.Client(timeout=12.0) as client:
                resp = client.post(endpoint, headers=_supabase_headers(key), json=[payload])
            if resp.status_code in (200, 201, 204):
                print("[Supabase] 📡 Telemetria registrada na nuvem!")
            else:
                msg = f"[Supabase] Aviso ao gravar telemetria HTTP {resp.status_code}: {resp.text[:200]}"
                if require_cloud:
                    raise RuntimeError(msg)
                print(msg)
        except RuntimeError:
            raise
        except Exception as exc:
            if require_cloud:
                raise RuntimeError(f"[Supabase] Telemetria obrigatória em nuvem não registrada: {exc}") from exc
            print(f"[Supabase] Telemetria em nuvem não registrada: {exc}")

    return health_data
