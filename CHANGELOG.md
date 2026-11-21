# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.

## [1.0.0] - 2026-11-21

### Adicionado
- **Sona Resume Studio (ATS Anti-Alucinação):** gerador de currículos em 3 camadas (análise de aderência, geração isolada por projeto/experiência e guardrails determinísticos + auditor semântico), suporte BYOK (Gemini, OpenAI, Groq, OpenRouter), GitHub Sync inteligente, parser de LinkedIn (`.zip`/PDF) e editor WYSIWYG.
- **Design System Obsidian Dark:** unificação visual em `DESIGN.md` e `design-system.css` para Dashboard, Insights, Parâmetros do Crawler e Resume Studio embutido.
- **Pipeline ETL em Python + Supabase:** extratores paralelos (LinkedIn, Gupy, Catho, Greenhouse e InHire), contratos Pydantic v2, auditoria circular por `updated_at` e modo fail-fast `--require-cloud` para GitHub Actions.
- **CI em Pull Requests:** workflow `.github/workflows/ci.yml` executando `npm test`, `pytest` e verificação de sincronia de `npm run build` (`public/`).
- **Cobertura de testes expandida:** testes unitários para segurança do servidor local, handlers serverless (`/api/*`), adaptador LLM, modo `--require-cloud` e extratores ATS/Gupy.

### Corrigido
- Bloqueio permanente e saneamento de URLs temporárias `grounding-api-redirect` expiradas.
- Adição da coluna `updated_at` e endurecimento das políticas RLS em `schema_supabase.sql` (remoção de escrita anônima aberta).
- Blindagem de `servidor.js` e `server.js` contra exposição de dotfiles/arquivos sensíveis, path traversal e bind aberto em `0.0.0.0` por padrão.
- Correção da renderização pós-sync na tela `02` em `dashboard.html` e restrição das chamadas legadas `localhost:3141` apenas para ambiente local.
- Remoção de caminho absoluto Windows hardcoded no teste E2E (`tests_py/test_e2e_studio.py`).
- Atualização de `.env.example`, `.vercelignore`, `package.json` (`license: MIT`) e `README.md`.
