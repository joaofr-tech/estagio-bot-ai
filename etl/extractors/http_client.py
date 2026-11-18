from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


@dataclass
class HttpResponse:
    ok: bool
    status_code: int
    body: str
    final_url: str
    error: str | None = None


def fetch_with_retry(
    url: str,
    headers: dict[str, str] | None = None,
    retries: int = 2,
    timeout: float = 10.0,
) -> HttpResponse:
    """Executa requisição HTTP GET com follow_redirects e retry com backoff exponencial."""
    merged_headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    if headers:
        merged_headers.update(headers)

    last_result = HttpResponse(ok=False, status_code=0, body="", final_url=url, error="Não executado")

    for attempt in range(retries + 1):
        try:
            with httpx.Client(follow_redirects=True, timeout=timeout) as client:
                resp = client.get(url, headers=merged_headers)
                ok = 200 <= resp.status_code < 400
                body_text = resp.text[:2_000_000] if resp.text else ""
                last_result = HttpResponse(
                    ok=ok,
                    status_code=resp.status_code,
                    body=body_text,
                    final_url=str(resp.url),
                    error=None if ok else f"HTTP {resp.status_code}",
                )
                if ok:
                    return last_result

                # Não repetir para 4xx definitivos (exceto 408 timeout e 429 rate limit)
                if 400 <= resp.status_code < 500 and resp.status_code not in (408, 429):
                    return last_result
        except httpx.TimeoutException:
            last_result = HttpResponse(
                ok=False,
                status_code=408,
                body="",
                final_url=url,
                error=f"Timeout após {timeout}s",
            )
        except Exception as exc:
            last_result = HttpResponse(
                ok=False,
                status_code=0,
                body="",
                final_url=url,
                error=str(exc) or "Erro de rede",
            )

        if attempt < retries:
            time.sleep(0.5 * (3**attempt))  # 0.5s, 1.5s

    return last_result
