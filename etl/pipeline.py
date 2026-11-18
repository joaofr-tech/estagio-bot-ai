from __future__ import annotations

import json
import os
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from .auditor import auditar_vagas_ativas
from .extractors import executar_extratores
from .models import AuditMetrics, PipelineRunTelemetry, SourceMetrics
from .notifier import (
    enviar_digest_email_pendentes,
    rotacionar_log_se_necessario,
    verificar_e_disparar_alerta_saude,
)
from .repository import (
    ROOT_DIR,
    carregar_vagas_atuais,
    registrar_telemetria,
    upsert_vagas,
)
from .transform import filtrar_e_transformar

LOCK_PATH = ROOT_DIR / ".pipeline.lock"
LOCK_MAX_AGE_SEC = 45 * 60
CONFIG_PATH = ROOT_DIR / "config_busca.json"
NOVAS_VAGAS_PATH = ROOT_DIR / "novas_vagas.json"
LOG_PATH = ROOT_DIR / "log_execucoes.txt"


def _carregar_config_busca() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _adquirir_lock(lock_path: Path = LOCK_PATH) -> tuple[bool, str | None]:
    if lock_path.exists():
        try:
            idade = time.time() - lock_path.stat().st_mtime
            if idade < LOCK_MAX_AGE_SEC:
                return False, f"Lock ativo há {int(idade)}s"
            print(f"[Pipeline] Lock órfão detectado ({int(idade // 60)} min). Sobrescrevendo...")
        except OSError:
            pass

    lock_path.write_text(
        json.dumps({"pid": os.getpid(), "startedAt": datetime.now().isoformat()}, indent=2),
        encoding="utf-8",
    )
    return True, None


def _liberar_lock(lock_path: Path = LOCK_PATH) -> None:
    try:
        if lock_path.exists():
            lock_path.unlink()
    except OSError:
        pass


def _carregar_novas_vagas_staged(file_path: Path = NOVAS_VAGAS_PATH) -> list[dict[str, Any]]:
    if not file_path.exists():
        return []
    try:
        parsed = json.loads(file_path.read_text(encoding="utf-8"))
        if not isinstance(parsed, list):
            return []
        return [{**v, "fonte": v.get("fonte") or "agy"} for v in parsed if isinstance(v, dict)]
    except Exception:
        return []


def _sincronizar_dashboard_index() -> None:
    src = ROOT_DIR / "dashboard.html"
    dest = ROOT_DIR / "index.html"
    if src.exists():
        shutil.copy2(src, dest)


def executar_pipeline(
    skip_network: bool | None = None,
    dry_run: bool | None = None,
    lock_path: Path = LOCK_PATH,
) -> dict[str, Any]:
    """Orquestrador principal do pipeline ETL em Python."""
    if skip_network is None:
        skip_network = "--skip-network" in sys.argv
    if dry_run is None:
        dry_run = "--dry-run" in sys.argv

    adquirido, motivo = _adquirir_lock(lock_path)
    if not adquirido:
        print(f"[Pipeline Python ETL] Execução abortada para evitar concorrência ({motivo}).")
        return {"skipped": True, "motivo": motivo}

    t0 = time.monotonic()
    try:
        print(f"[Pipeline Python ETL] Iniciando (skip_network={skip_network}, dry_run={dry_run})...")
        config = _carregar_config_busca()

        # 1. Fonte Única da Verdade (Supabase PostgreSQL, com fallback local offline)
        vagas_existentes, origem_banco = carregar_vagas_atuais(skip_network=skip_network)
        print(f"[Pipeline Python ETL] Base carregada de '{origem_banco}' ({len(vagas_existentes)} vagas).")

        # 2. Extract (LinkedIn, Gupy, Catho, Greenhouse/InHire em paralelo)
        jobs_brutas, fontes = executar_extratores(config, skip_network=skip_network)

        # 3. Mesclar saída complementar eventual do agente IA em novas_vagas.json
        vagas_staged = _carregar_novas_vagas_staged()
        if vagas_staged:
            fontes["agy"] = SourceMetrics(status="ok", brutas=len(vagas_staged), latenciaMs=0, erro=None)
            jobs_brutas.extend(vagas_staged)

        # 4. Transform (Pydantic v2 + Deduplicação + Mismatch)
        ineditas, funil = filtrar_e_transformar(jobs_brutas, vagas_existentes)

        # 5. Load (UPSERT no PostgreSQL Supabase + cache local)
        if not dry_run and ineditas:
            upsert_vagas(ineditas, banco_atual=vagas_existentes, skip_network=skip_network)
            vagas_existentes = [v.to_local_dict() for v in ineditas] + vagas_existentes

        if not dry_run and vagas_staged and NOVAS_VAGAS_PATH.exists():
            try:
                NOVAS_VAGAS_PATH.unlink()
            except OSError:
                pass

        # 6. Audit (Fila circular no Supabase)
        auditoria = AuditMetrics(verificadas=0, encerradasCount=0)
        if not skip_network and not dry_run:
            auditoria = auditar_vagas_ativas(vagas_existentes, limite=60, skip_network=skip_network)

        # 7. Notify (Digest SMTP se configurado)
        if not skip_network and not dry_run:
            enviar_digest_email_pendentes(vagas_existentes, skip_network=skip_network)

        # 8. Observabilidade e Higiene
        duracao_seg = int(round(time.monotonic() - t0))
        fontes_ativas = [f for f in fontes.values() if f.status != "skipped"]
        todas_falharam = bool(fontes_ativas) and all(f.status == "error" for f in fontes_ativas)

        status = "SEM_VAGAS"
        mensagem = "Varredura Python ETL concluída. Nenhuma vaga nova nesta rodada."
        if todas_falharam and not ineditas:
            status = "ERRO_CRAWLER"
            mensagem = "Todas as fontes determinísticas falharam nesta rodada."
        elif ineditas:
            status = "VAGAS_SALVAS"
            mensagem = f"{len(ineditas)} nova(s) oportunidade(s) catalogada(s) via Python ETL."

        health_data = None
        if not dry_run:
            telemetria = PipelineRunTelemetry(
                timestamp=datetime.now().strftime("%d/%m/%Y, %H:%M:%S"),
                status=status,
                isErro=(status == "ERRO_CRAWLER"),
                duracaoSegundos=duracao_seg,
                mensagem=mensagem,
                vagas=[v.to_local_dict() for v in ineditas],
                fontes=fontes,
                funil=funil,
                auditoria=auditoria,
            )
            health_data = registrar_telemetria(telemetria, skip_network=skip_network)
            _sincronizar_dashboard_index()
            rotacionar_log_se_necessario(LOG_PATH)
            verificar_e_disparar_alerta_saude(health_data, skip_network=skip_network)

        print(f"[Pipeline Python ETL] Concluído em {duracao_seg}s | Status: {status} | Funil: {funil.model_dump_json()}")
        return {
            "skipped": False,
            "origemBanco": origem_banco,
            "status": status,
            "duracaoSegundos": duracao_seg,
            "fontes": {k: v.model_dump() for k, v in fontes.items()},
            "funil": funil.model_dump(),
            "auditoria": auditoria.model_dump(),
            "vagasSalvasCount": len(ineditas),
            "healthData": health_data,
        }
    finally:
        _liberar_lock(lock_path)


if __name__ == "__main__":
    resultado = executar_pipeline()
    sys.exit(1 if resultado.get("status") == "ERRO_CRAWLER" else 0)
