#!/usr/bin/env python3
"""
Auditoria automatizada de UI do Sona baseada no DESIGN.md e em ui-humanizer/scripts/audit.py.

Detecta assinaturas de UI genérica ("cara de IA") proibidas pelo DESIGN.md:
- A9: emojis em qualquer parte da UI
- A1: eyebrows/kickers em caixa alta acima de títulos
- A2: texto em gradiente
- A5: borda lateral/superior pintada em cards
- A7: bolinha/elemento pulsando
- A8: sparkle / "powered by AI"
- A10: roxo/índigo padrão do Tailwind
- A12: glassmorphism (backdrop-filter blur)
- B11: copy de template SaaS

Uso:
  python scripts/audit_ui.py
  python scripts/audit_ui.py --strict
  python scripts/audit_ui.py dashboard.html curriculo.html design-system.css
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_TARGETS = [
    "dashboard.html",
    "curriculo.html",
    "auth.html",
    "design-system.css",
    "curriculo.css",
    "auth.css",
]

EXTS = {".html", ".htm", ".css", ".scss", ".jsx", ".tsx", ".js"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "public", "legacy", "tests", ".venv"}

EMOJI = r"[\U0001F300-\U0001FAFF\u2600-\u27BF\u2B50\u2728]"

RULES: list[tuple[str, str, str]] = [
    (
        "A1",
        "eyebrow/kicker: texto caixa alta com tracking largo",
        r"(class=[\"'][^\"']*\b(eyebrow|kicker|overline|section-label)\b)",
    ),
    (
        "A2",
        "texto em gradiente",
        r"(bg-clip-text|background-clip:\s*text|-webkit-background-clip:\s*text|-webkit-text-fill-color:\s*transparent)",
    ),
    (
        "A5",
        "borda lateral pintada",
        r"(border-left:\s*[3-8]px\s+solid|border-inline-start:\s*[3-8]px)",
    ),
    (
        "A7",
        "bolinha/elemento pulsando",
        r"(animate-ping|animate-pulse|@keyframes\s+(pulse|ping|blink)\b)",
    ),
    (
        "A8",
        "sparkle / 'powered by AI'",
        r"(\bSparkles\b|lucide-sparkles|(?i:powered by ai|feito com ia|ai-powered))",
    ),
    ("A9", "emoji na interface (proibido pelo DESIGN.md)", EMOJI),
    (
        "A10",
        "roxo/indigo padrao do Tailwind",
        r"(\b(violet|indigo|purple|fuchsia)-(400|500|600|700)\b|#(8b5cf6|7c3aed|6366f1|4f46e5|a855f7|9333ea|6d28d9)\b)",
    ),
    (
        "A12",
        "glassmorphism (backdrop-filter blur)",
        r"(backdrop-filter:\s*blur|backdrop-blur)",
    ),
    (
        "B11",
        "copy de template SaaS generico",
        r"(?i)(comece agora|get started( for free| today)?|solu[cç][aã]o completa|tudo em um s[oó] lugar|seamless(ly)?|supercharge|unlock (the|your)|elevate your|all-in-one|revolucion[ea]|potencializ[ea]|next[- ]level)",
    ),
]

COMPILED = [(rid, desc, re.compile(pattern)) for rid, desc, pattern in RULES]
ALLOW_MARKER_RE = re.compile(r"sona-allow:\s*([A-Z0-9,\s]+)", re.IGNORECASE)


def iter_files(paths: list[str]) -> list[Path]:
    result: list[Path] = []
    for raw in paths:
        p = Path(raw)
        if not p.is_absolute():
            p = ROOT_DIR / p
        if p.is_file():
            result.append(p)
        elif p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file() and f.suffix.lower() in EXTS and not (SKIP_DIRS & set(f.parts)):
                    result.append(f)
    return result


def audit_paths(paths: list[str]) -> list[dict[str, object]]:
    findings: list[dict[str, object]] = []
    for f in iter_files(paths):
        try:
            lines = f.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        for lineno, line in enumerate(lines, 1):
            allow_match = ALLOW_MARKER_RE.search(line)
            allowed_ids = (
                {tok.strip().upper() for tok in allow_match.group(1).split(",") if tok.strip()}
                if allow_match
                else set()
            )
            sample_line = line[:2000]
            for rid, desc, rx in COMPILED:
                if rid in allowed_ids or "ALL" in allowed_ids:
                    continue
                m = rx.search(sample_line)
                if m:
                    start = max(0, m.start() - 35)
                    snippet = sample_line[start : m.end() + 35].strip()
                    findings.append({
                        "file": str(f.relative_to(ROOT_DIR)) if f.is_relative_to(ROOT_DIR) else str(f),
                        "line": lineno,
                        "id": rid,
                        "desc": desc,
                        "snippet": snippet,
                    })
    return findings


def main(argv: list[str]) -> int:
    strict = "--strict" in argv
    raw_paths = [a for a in argv if not a.startswith("--")]
    targets = raw_paths or DEFAULT_TARGETS

    findings = audit_paths(targets)
    counts: dict[str, int] = {}
    for item in findings:
        rid = str(item["id"])
        counts[rid] = counts.get(rid, 0) + 1
        print(f"{item['file']}:{item['line']}  [{rid}] {item['desc']}  | {item['snippet']}")

    print("\nResumo da Auditoria de UI (Sona DESIGN.md):")
    if not counts:
        print("  Nenhum tell de UI encontrado nos arquivos verificados.")
    else:
        for rid, desc, _ in COMPILED:
            if rid in counts:
                print(f"  {rid:4} {counts[rid]:4}x  {desc}")

    class_a = sum(v for k, v in counts.items() if k.startswith("A"))
    if strict and class_a > 0:
        print(f"\n[FALHA --strict] {class_a} ocorrência(s) Classe A detectada(s).")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
