from __future__ import annotations

import json
import random
import re
import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

DEFAULT_HEADERS: dict[str, str] = {
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate",
    "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
}

SILENT_BLOCK_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"just a moment\.\.\.|cf-browser-verification|challenge-platform", re.I), "Cloudflare challenge"),
    (re.compile(r"attention required!\s*\|\s*cloudflare", re.I), "Cloudflare WAF block"),
    (re.compile(r"geo\.captcha-delivery\.com|datadome", re.I), "DataDome anti-bot"),
    (re.compile(r"_abck|ak_bmsc|akamai\s+bot\s+manager", re.I), "Akamai Bot Manager"),
    (re.compile(r"px-captcha|perimeterx", re.I), "PerimeterX challenge"),
    (re.compile(r"/authwall|join linkedin to view", re.I), "LinkedIn authwall"),
]

_THREAD_LOCAL = threading.local()

try:
    from curl_cffi import requests as _curl_cffi_requests  # type: ignore
except Exception:
    _curl_cffi_requests = None


@dataclass
class HttpResponse:
    ok: bool
    status_code: int
    body: str
    final_url: str
    error: str | None = None
    blocked: bool = False
    block_reason: str | None = None


def _get_thread_client(timeout: float) -> httpx.Client:
    """Mantém uma sessão httpx persistente por thread (reuso de cookies e conexões TLS)."""
    client: httpx.Client | None = getattr(_THREAD_LOCAL, "client", None)
    if client is None or client.is_closed:
        client = httpx.Client(
            follow_redirects=True,
            timeout=timeout,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
        _THREAD_LOCAL.client = client
    return client


def close_thread_client() -> None:
    """Encerra o cliente persistente da thread atual, se aberto."""
    client: httpx.Client | None = getattr(_THREAD_LOCAL, "client", None)
    if client is not None and not client.is_closed:
        client.close()
    _THREAD_LOCAL.client = None


def detect_silent_block(status_code: int, body: str, final_url: str = "") -> tuple[bool, str | None]:
    """Detecta bloqueios silenciosos (WAF/challenge em HTTP 200/403) sem falsos positivos em páginas normais."""
    if status_code in (403, 429, 503):
        sample = f"{final_url}\n{(body or '')[:8000]}"
        for pattern, reason in SILENT_BLOCK_PATTERNS:
            if pattern.search(sample):
                return True, reason
        if status_code == 429:
            return True, "HTTP 429 Rate Limit"
        return False, None

    if 200 <= status_code < 400 and body:
        # Só inspeciona páginas curtas/intersticiais ou redirecionamentos de authwall
        head = body[:8000]
        if "/authwall" in (final_url or "").lower():
            return True, "LinkedIn authwall"
        if len(body) < 40_000:
            for pattern, reason in SILENT_BLOCK_PATTERNS:
                if pattern.search(head):
                    return True, reason
    return False, None


def _parse_retry_after(header_value: str | None, max_wait: float = 15.0) -> float | None:
    """Interpreta header Retry-After em segundos com teto de segurança."""
    if not header_value:
        return None
    raw = header_value.strip()
    if raw.isdigit():
        return min(float(int(raw)), max_wait)
    try:
        val = float(raw)
        if val > 0:
            return min(val, max_wait)
    except ValueError:
        return None
    return None


def _try_curl_cffi_fallback(url: str, headers: dict[str, str], timeout: float) -> HttpResponse | None:
    """Fallback opcional de TLS impersonation (Nível 3) caso curl_cffi esteja instalado."""
    if _curl_cffi_requests is None:
        return None
    for profile in ("chrome", "safari", "firefox"):
        try:
            resp = _curl_cffi_requests.get(url, headers=headers, impersonate=profile, timeout=timeout)
            body_text = resp.text[:2_000_000] if getattr(resp, "text", None) else ""
            final_url = str(getattr(resp, "url", url))
            blocked, block_reason = detect_silent_block(resp.status_code, body_text, final_url)
            ok = 200 <= resp.status_code < 400 and not blocked
            if ok:
                return HttpResponse(
                    ok=True,
                    status_code=resp.status_code,
                    body=body_text,
                    final_url=final_url,
                    error=None,
                    blocked=False,
                )
        except Exception:
            continue
    return None


def extract_json_ld_job_postings(html: str) -> list[dict[str, Any]]:
    """Extrai blocos JSON-LD com @type == JobPosting (dados estruturados de SEO — Nível 1)."""
    if not html:
        return []
    scripts = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>',
        html,
        flags=re.IGNORECASE,
    )
    postings: list[dict[str, Any]] = []

    def _collect(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                _collect(item)
            return
        if not isinstance(node, dict):
            return
        node_type = node.get("@type")
        is_job = (
            (isinstance(node_type, str) and node_type.lower() == "jobposting")
            or (isinstance(node_type, list) and any(str(t).lower() == "jobposting" for t in node_type))
        )
        if is_job:
            postings.append(node)
        if "@graph" in node:
            _collect(node["@graph"])

    for raw in scripts:
        cleaned = raw.strip()
        if not cleaned:
            continue
        try:
            parsed = json.loads(cleaned)
        except Exception:
            continue
        _collect(parsed)

    return postings


def fetch_with_retry(
    url: str,
    headers: dict[str, str] | None = None,
    retries: int = 2,
    timeout: float = 10.0,
    allow_tls_fallback: bool = True,
) -> HttpResponse:
    """
    Executa requisição HTTP GET resiliente com:
    - Sessão httpx persistente por thread (reuso de conexões e cookies)
    - Retry com backoff exponencial + jitter e respeito a Retry-After (429)
    - Detecção de bloqueio silencioso (WAF/challenge em HTTP 200)
    - Fallback opcional de TLS fingerprint via curl_cffi em 403/bloqueio
    """
    merged_headers = dict(DEFAULT_HEADERS)
    if headers:
        merged_headers.update(headers)

    last_result = HttpResponse(ok=False, status_code=0, body="", final_url=url, error="Não executado")

    for attempt in range(retries + 1):
        retry_after_sec: float | None = None
        try:
            client = _get_thread_client(timeout)
            resp = client.get(url, headers=merged_headers, timeout=timeout)
            body_text = resp.text[:2_000_000] if resp.text else ""
            final_url = str(resp.url)
            blocked, block_reason = detect_silent_block(resp.status_code, body_text, final_url)
            ok = 200 <= resp.status_code < 400 and not blocked

            error_msg: str | None = None
            if not ok:
                error_msg = f"Bloqueio detectado ({block_reason})" if blocked else f"HTTP {resp.status_code}"

            last_result = HttpResponse(
                ok=ok,
                status_code=resp.status_code,
                body=body_text,
                final_url=final_url,
                error=error_msg,
                blocked=blocked,
                block_reason=block_reason,
            )

            if ok:
                return last_result

            # Em bloqueio TLS/WAF (403 ou challenge silencioso), tenta fallback curl_cffi antes de desistir
            if allow_tls_fallback and (resp.status_code == 403 or blocked):
                fallback = _try_curl_cffi_fallback(url, merged_headers, timeout)
                if fallback and fallback.ok:
                    return fallback

            if resp.status_code == 429:
                retry_after_sec = _parse_retry_after(resp.headers.get("Retry-After"))

            # Não repetir para 4xx definitivos (exceto 408 timeout e 429 rate limit)
            if 400 <= resp.status_code < 500 and resp.status_code not in (408, 429):
                return last_result

            # Se tomou challenge explícito de WAF em HTTP 200, repetir imediatamente sem proxy raramente ajuda
            if blocked and resp.status_code != 429:
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
            base_delay = retry_after_sec if retry_after_sec is not None else (0.5 * (3**attempt))
            jitter = random.uniform(0.05, 0.35)
            time.sleep(base_delay + jitter)

    return last_result
