from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any

from ..models import SourceMetrics
from . import ats, catho, gupy, linkedin

EXTRATORES = [
    ("linkedin", linkedin.extract),
    ("gupy", gupy.extract),
    ("catho", catho.extract),
    ("ats_greenhouse_inhire", ats.extract),
]


def executar_extratores(
    config: dict[str, Any] | None = None,
    skip_network: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, SourceMetrics]]:
    """Executa todos os extratores em paralelo via ThreadPoolExecutor."""
    config = config or {}
    fontes: dict[str, SourceMetrics] = {}
    jobs_brutas: list[dict[str, Any]] = []

    if skip_network:
        for name, _ in EXTRATORES:
            fontes[name] = SourceMetrics(status="skipped", brutas=0, latenciaMs=0, erro=None)
        return jobs_brutas, fontes

    with ThreadPoolExecutor(max_workers=len(EXTRATORES)) as pool:
        future_map = {name: pool.submit(fn, config) for name, fn in EXTRATORES}
        for name, fut in future_map.items():
            try:
                res = fut.result()
                lista = res.get("jobs") or []
                fontes[name] = SourceMetrics(
                    status="ok" if res.get("ok") else "error",
                    brutas=len(lista),
                    latenciaMs=int(res.get("durationMs") or 0),
                    erro=res.get("error"),
                )
                jobs_brutas.extend(lista)
            except Exception as exc:
                fontes[name] = SourceMetrics(
                    status="error",
                    brutas=0,
                    latenciaMs=0,
                    erro=str(exc),
                )

    return jobs_brutas, fontes
