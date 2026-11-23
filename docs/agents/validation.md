# Validation Commands (`docs/agents/validation.md`)

Execute estes comandos antes de declarar qualquer tarefa concluída ou abrir PR:

```bash
# 1. Testes Node.js (Candidaturas, Indicadores, Parâmetros, ETL Node, Motor ATS, APIs, Segurança e Chaos)
npm test

# 2. Testes Python ETL (Unitários + Chaos Engineering)
pytest tests_py/test_etl_pipeline.py tests_py/test_etl_chaos.py -v

# 3. Auditoria de UI contra DESIGN.md (ui-humanizer adaptado)
npm run audit:ui

# 4. Build estático e verificação de sincronia com public/
npm run build
git diff --exit-code public/
```

## Opcionais (quando houver alteração de UI interativa ou fluxo completo)
```bash
# Teste E2E com Playwright
npm run test:e2e

# Simulação offline do pipeline ETL
python -m etl.pipeline --skip-network --dry-run
```

## Orçamento de PR
- **PR size budget:** até **500 linhas de produção alteradas** por PR (testes e artefatos gerados em `public/` não entram na conta). Se passar, dividir em PRs menores e independentes.
