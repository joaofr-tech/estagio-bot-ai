#!/usr/bin/env python3
"""
Renderizador e validador determinístico de currículo em 1 página (stdlib pura).
Portado e adaptado de lincolixavier/job-hunt-agent/src/jobhunt/pdf.py.

Uso:
  python scripts/check_pdf_pages.py caminho/curriculo.pdf
  python scripts/check_pdf_pages.py --render entrada.html saida.pdf [--max-pages 1]
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

BINARY_NAMES = [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "chrome",
    "msedge",
]

PLATFORM_PATHS = {
    "darwin": [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
    "win32": [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ],
}


class PdfError(RuntimeError):
    pass


def find_chrome() -> str | None:
    env = os.environ.get("SONA_CHROME") or os.environ.get("CHROME_BIN")
    if env:
        return env if Path(env).exists() or shutil.which(env) else None
    for name in BINARY_NAMES:
        found = shutil.which(name)
        if found:
            return found
    for candidate in PLATFORM_PATHS.get(sys.platform, []):
        if Path(candidate).exists():
            return candidate
    return None


def html_to_pdf(html_path: Path, pdf_path: Path, chrome: str | None = None) -> None:
    chrome_bin = chrome or find_chrome()
    if not chrome_bin:
        raise PdfError("Chrome/Chromium/Edge não encontrado. Defina SONA_CHROME=/caminho/do/browser.")
    args = [
        chrome_bin,
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={pdf_path.resolve()}",
        html_path.resolve().as_uri(),
    ]
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        args.insert(1, "--no-sandbox")
    try:
        subprocess.run(args, check=True, capture_output=True, timeout=90)
    except subprocess.CalledProcessError as exc:
        raise PdfError(
            f"Falha ao gerar PDF de {html_path.name}: {exc.stderr.decode(errors='ignore')[:400]}"
        ) from exc
    except subprocess.TimeoutExpired:
        raise PdfError(f"Timeout ao imprimir {html_path.name}") from None
    if not pdf_path.exists():
        raise PdfError(f"Navegador terminou sem gravar {pdf_path}")


def page_count(pdf_path: Path) -> int:
    """Conta páginas de um PDF via pdfinfo (se disponível) ou inspeção direta da árvore /Pages."""
    if shutil.which("pdfinfo"):
        out = subprocess.run(["pdfinfo", str(pdf_path)], capture_output=True, text=True).stdout
        for line in out.splitlines():
            if line.startswith("Pages:"):
                return int(line.split()[-1])
    data = pdf_path.read_bytes()
    counts = [int(n) for n in re.findall(rb"/Type\s*/Pages\b[^>]*?/Count\s+(\d+)", data)]
    if counts:
        return max(counts)
    return len(re.findall(rb"/Type\s*/Page(?![a-zA-Z])", data))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Valida e renderiza PDFs de currículo do Sona (garantia de 1 página).")
    parser.add_argument("input_path", help="Arquivo .pdf para validar ou .html (com --render)")
    parser.add_argument("output_pdf", nargs="?", help="Arquivo .pdf de saída quando usar --render")
    parser.add_argument("--render", action="store_true", help="Renderiza HTML para PDF via Chrome/Edge headless")
    parser.add_argument("--max-pages", type=int, default=1, help="Limite máximo de páginas permitido (padrão: 1)")
    args = parser.parse_args(argv)

    target_pdf = Path(args.input_path)
    if args.render:
        if not args.output_pdf:
            parser.error("--render exige informar o caminho de output_pdf")
        target_pdf = Path(args.output_pdf)
        html_to_pdf(Path(args.input_path), target_pdf)

    if not target_pdf.exists():
        print(f"[ERRO] Arquivo não encontrado: {target_pdf}", file=sys.stderr)
        return 2

    pages = page_count(target_pdf)
    print(f"PDF: {target_pdf} | Páginas: {pages} (máximo: {args.max_pages})")
    if pages > args.max_pages:
        print(f"[FALHA] Currículo estourou o limite de {args.max_pages} página(s).", file=sys.stderr)
        return 1
    if pages == 0:
        print("[FALHA] Nenhuma página válida encontrada no PDF.", file=sys.stderr)
        return 1
    print("[OK] Limite de páginas respeitado.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
