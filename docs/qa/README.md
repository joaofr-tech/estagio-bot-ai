# Sona — Loop Autônomo de QA, Auto-Fix e PR Review (`docs/qa/README.md`)

Fluxo completo rodando 100% na sua assinatura do **Orca (`antigravity`)**, usando **Orca Built-in Browser** (sem Playwright) e **GitHub CLI (`gh`)**.

## Arquitetura das 3 Fases

| Fase | Automação no Orca | Frequência | Precheck (Custo Zero) | O que faz |
| :--- | :--- | :--- | :--- | :--- |
| **1 — QA Explorer** | `Sona QA Explorer` | Diária (`03:00`) | — | Sobe `servidor.js` local (`127.0.0.1`), navega pelas missões em `docs/qa/missions.md` via Orca Browser, reproduz bugs 2x e abre Issues deduplicadas (`qa-bot`). |
| **2 — Auto-Fixer** | `Sona Auto-Fixer` | Horária | `node scripts/qa/precheck_fixer.js` | Só roda se houver Issue com label `auto-fix` sem PR e `< 3` PRs `fix/auto-*` abertos. Cria branch, escreve teste que falha antes do fix, corrige, valida tudo e abre PR. |
| **3 — PR Reviewer** | `Sona PR Reviewer` | Horária | `node scripts/qa/precheck_reviewer.js` | Só roda se houver PR `fix/auto-*` aberto (não draft) sem label `ai-reviewed`. Faz revisão adversarial contra `GUIDELINES.md` e `DESIGN.md`, roda validação independente e posta parecer. **Merge sempre humano.** |

## Como Operar

### 1. Login único no perfil isolado `Sona QA Bot`
Para que o bot navegue autenticado em `/dashboard.html` e `/curriculo.html` sem salvar senhas em disco:
- Perfil isolado no Orca: `Sona QA Bot` (`id: 1f6aaac9-1a2a-4666-bbc8-0fb08f6d6827`)
- Origem local fixa: `http://127.0.0.1:3456` (porta padrão de `scripts/qa/qa_server.js`)
- Para renovar a sessão quando expirar:
  ```powershell
  node scripts/qa/qa_server.js --start
  orca tab create --url "http://127.0.0.1:3456/auth.html" --profile 1f6aaac9-1a2a-4666-bbc8-0fb08f6d6827 --focus --json
  ```
  Faça login com sua conta de teste na aba aberta e depois encerre o servidor com `node scripts/qa/qa_server.js --stop <pid>`.

### 2. Subir para `main` antes de habilitar
Como as 3 automações usam `new_per_run` (worktree limpo a partir da branch base `main`), faça commit e push dos arquivos em `scripts/qa/`, `docs/qa/` e `tests/qa_bot.test.js` para `main` antes de rodar as automações.

### 2. Testar manualmente qualquer fase sob demanda
```bash
orca automations list --json
orca automations run <automationId> --json
```

### 3. Habilitar o agendamento automático
```bash
orca automations edit <automationId> --enabled --json
```

### 4. Modos de Conexão entre Fase 1 e Fase 2
- **Modo Supervisionado (padrão recomendado no início):** a Fase 1 abre a Issue com label `qa-bot`. Você revisa rapidamente e adiciona a label `auto-fix` na Issue para liberar a Fase 2.
- **Modo Loop Completo Automático:** ao chamar `node scripts/qa/qa_issue.js --auto-fix ...` (ou editar o prompt da Fase 1 para incluir `--auto-fix` / `SONA_QA_AUTO_FIX=true`), toda Issue confirmada 2x pela Fase 1 já nasce com `auto-fix` e entra automaticamente na fila da Fase 2 → Fase 3 (mantendo o teto de 3 PRs abertos e o merge sempre humano).
