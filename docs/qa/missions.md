# Sona QA Explorer — Missões Exploratórias (`docs/qa/missions.md`)

Cada missão descreve **objetivos de um usuário real** — nunca scripts engessados com seletores fixos. O agente deve explorar a tela via Orca Built-in Browser (`orca snapshot`, `orca click`, `orca fill`, `orca type`, `orca scroll`, `orca viewport`, `orca screenshot`, `orca console`, `orca network`).

---

## Missão 1 — Dashboard Principal (`/dashboard.html`)
- **Objetivo:** Verificar que o painel de vagas abre limpo, permite buscar/filtrar vagas, alternar abas/seções e não quebra em desktop nem em mobile.
- **Exploração esperada:**
  1. Abrir `/dashboard.html` em desktop e verificar carregamento sem erros JS (`pageerror` / `console.error`).
  2. Digitar um termo no campo de busca (ex: `Python`, depois um termo inexistente como `zzzz_nao_existe_123`) e confirmar que a UI responde sem travar nem quebrar.
  3. Interagir com filtros/abas disponíveis (status, ordenação, indicadores ou candidaturas).
  4. Testar viewport mobile (`390x844`) e conferir se não há overflow horizontal severo (`document.documentElement.scrollWidth > window.innerWidth + 16`) nem elementos sobrepostos ilegíveis.
- **Ruído esperado a ignorar:** Falhas de conexão com Supabase externo quando não houver credenciais configuradas no ambiente local isolado.

## Missão 2 — Sona Resume Studio (`/curriculo.html`)
- **Objetivo:** Garantir que o estúdio de currículo carrega, aceita entrada do usuário, valida campos vazios/inválidos e não dispara exceções JS.
- **Exploração esperada:**
  1. Abrir `/curriculo.html` e verificar renderização completa (editor/formulário + preview).
  2. Testar preenchimento de campos de texto (ex: nome, objetivo/resumo, descrição da vaga) e confirmar reação da interface.
  3. Acionar validação com campos vazios ou ações principais de interface (ex: alternar abas/modos, abrir modal de configuração BYOK sem salvar chave real).
  4. Testar viewport mobile (`390x844`) e verificar integridade visual.
- **Regra de segurança:** Nunca inserir chaves reais de LLM ou disparar chamadas pagas externas.

## Missão 3 — Autenticação (`/auth.html`)
- **Objetivo:** Verificar que a tela de autenticação renderiza corretamente, valida e-mail/senha inválidos e alterna modos sem erros JS.
- **Exploração esperada:**
  1. Abrir `/auth.html`.
  2. Tentar submeter formulário vazio e depois com e-mail malformado (`teste-invalido`) e confirmar feedback de validação sem erro não tratado.
  3. Alternar entre abas/modos (Entrar / Criar Conta / Recuperação, se presentes).
  4. Checar layout em desktop e mobile (`390x844`).

## Missão 4 — Contratos HTTP e Segurança Local (`/api/*` e arquivos bloqueados)
- **Objetivo:** Garantir que o servidor local respeita os invariantes de segurança (`GUIDELINES.md §1.2`).
- **Exploração esperada:**
  1. Verificar via `orca eval` ou requisição `fetch` para a própria origem local que:
     - `/.env`, `/servidor.js` e `/package.json` retornam `403`.
     - `/api/endpoint_inexistente` retorna `404` JSON limpo (sem stacktrace).
     - `POST /api/fetch-jd` com URL loopback (`http://127.0.0.1:80`) é bloqueado (status `400` ou `403`, nunca `200`).
