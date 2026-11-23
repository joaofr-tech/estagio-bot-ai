# Sona — Agent Instructions (`AGENTS.md`)

Este repositório segue a configuração modular de agentes em `docs/agents/` e as regras técnicas em `GUIDELINES.md` e `DESIGN.md`.

## Idioma
- Responda ao usuário em **Português do Brasil (pt-BR)**. Ver `docs/agents/language.md`.

## Leitura Obrigatória Antes de Alterar Código
1. `GUIDELINES.md` — regras de engenharia, contratos entre camadas e **Domain Criticality** (invariantes sagrados do Sona).
2. `DESIGN.md` — fonte única de verdade visual e de UX Writing (Obsidian Dark, zero emojis, microcopy literal).
3. `docs/agents/validation.md` — comandos de validação obrigatórios antes de qualquer commit/PR.
4. `docs/agents/workflow.md` — fluxo de branches, PRs, testes adversariais e sincronização de `public/`.

## Resumo Rápido da Arquitetura
- `etl/` — Pipeline ETL concorrente em Python 3.12+ (`httpx`, `Pydantic v2`, Supabase PostgreSQL).
- `api/` — Vercel Serverless Functions em Node.js 20+ (CommonJS) para o **Sona Resume Studio** (`/api/generate-resume`, `/api/github-sync`, `/api/parse-resume-pdf`, `/api/fetch-jd`).
- `dashboard.html`, `curriculo.html`, `design-system.css`, `curriculo.css`, `curriculo.js` — Interface web (copiada para `public/` via `npm run build`).
- `verificar_emails.js` — Monitor IMAP de processos seletivos com detecção de convocações, rejeições, ofertas e follow-ups (>21 dias).
- `tests/` e `tests_py/` — Suítes automatizadas (unitárias, integração, segurança, chaos engineering e E2E).
