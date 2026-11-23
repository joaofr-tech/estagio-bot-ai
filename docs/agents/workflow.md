# Workflow Context (`docs/agents/workflow.md`)

Configuração de papéis do projeto Sona (compatível com o fluxo `ship-it`).

| Papel | Configuração |
| :--- | :--- |
| **Repo** | GitHub (`main` como branch base; feature branches + PR flow) |
| **Tracker** | GitHub Issues (ou cards locais em `tasks/*.md` quando offline) |
| **Reviewer** | Self-review rigoroso + CI GitHub Actions (`.github/workflows/ci.yml`) |
| **Notifier** | Resumo objetivo no chat |
| **Deploy** | Vercel (`public/` + `api/*`) e GitHub Actions horário (`etl_pipeline.yml`) |

## Checklist de Pré-Merge
1. Todos os comandos de `docs/agents/validation.md` passaram sem erros.
2. Nenhum segredo (`.env`, chaves BYOK, `email_config.json`, tokens) presente no diff.
3. Mudanças em áreas de criticidade de domínio (`GUIDELINES.md §1`) cobertas por testes unitários e/ou adversariais.
4. `public/` sincronizado via `npm run build`.
