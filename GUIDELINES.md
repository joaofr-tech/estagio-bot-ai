# Sona — Engineering Guidelines (`GUIDELINES.md`)

Regras objetivas e verificáveis para humanos e agentes atuando no Sona.

---

## 1. Domain Criticality (Invariantes Sagrados)

Qualquer bug que viole um destes itens é **Crítico (P0)** e bloqueia merge imediatamente:

1. **Zero Alucinação no Currículo (`api/_lib/resume_engine.js`):**
   - Nenhuma skill fora da whitelist verificada (`buildSkillsWhitelist`) pode aparecer em `skills_grouped` ou `tech_stack`.
   - Formação acadêmica (`education`) e dados básicos (`basics`) são copiados deterministicamente — o LLM nunca pode alterá-los.
   - Termos de `excluded_gaps` não podem vazar sem alerta/correção.
   - Toda descrição de vaga externa (`jdText`) deve passar por `sanitizeJobDescription` antes do prompt ao LLM.
2. **Segurança, Credenciais & SSRF (`servidor.js`, `api/*`, Supabase RLS):**
   - Chaves BYOK (`X-LLM-Key`), `.env`, `email_config.json` e `SUPABASE_SERVICE_ROLE_KEY` nunca podem ser commitadas, logadas ou servidas via HTTP.
   - `servidor.js` deve escutar apenas em `127.0.0.1` por padrão e bloquear dotfiles/diretórios internos (`isSensitiveOrUnsafePath`).
   - Endpoints que buscam URLs externas (`api/fetch-jd.js`) devem bloquear IPs privados, loopback e metadata cloud (SSRF).
3. **Integridade da Base de Vagas (`etl/`):**
   - Nenhuma vaga sem `empresa`/`cargo` ou com link inválido / `grounding-api-redirect` pode ser persistida (`VagaRecord` em `etl/models.py`).
   - Deduplicação canônica (`empresa::cargo` + `link`) é obrigatória antes de `UPSERT`.
   - Execuções de produção/CI devem rodar com `--require-cloud` (fail-fast se Supabase indisponível).
4. **Sincronia de Deploy Estático (`public/`):**
   - Sempre que qualquer arquivo de frontend listado em `scripts/build_dashboard.js` mudar, executar `npm run build` antes de commitar.

---

## 2. Convenções por Stack

### Python (`etl/`, `scripts/`, `tests_py/`)
- Python 3.12+, tipagem estática em assinaturas públicas, contratos de dados via `Pydantic v2` ou `dataclass`.
- Toda chamada HTTP de extração/auditoria deve passar por `etl/extractors/http_client.py` (`fetch_with_retry`), que gerencia sessão persistente, jitter, `Retry-After` e detecção de bloqueios silenciosos.
- Priorizar a escada mais barata: API pública → JSON-LD (`extract_json_ld_job_postings`) → HTML → fallback TLS (`curl_cffi` opcional). Nunca adicionar CAPTCHA solvers.
- Testes unitários e de chaos **nunca** fazem requisições de rede reais (sempre mockados via `monkeypatch`).

### Node.js (`api/`, `servidor.js`, `verificar_emails.js`, `tests/`)
- Módulo CommonJS (`"type": "commonjs"`). Sem dependências pesadas desnecessárias em `api/`.
- Toda Serverless Function em `api/` deve tratar `OPTIONS` (204), validar método HTTP (405), validar payload (400) e retornar JSON consistente.
- Ao criar nova função em `api/`, registrar `maxDuration` em `vercel.json` e cobrir com testes em `tests/`.

### Frontend & Design System (`dashboard.html`, `curriculo.html`, `design-system.css`, `curriculo.css`)
- Obedecer integralmente ao `DESIGN.md`: Obsidian Dark, zero emojis na UI, zero card dentro de card, zero kicker/eyebrow decorativo, microcopy literal em Title Case.
- Rodar `npm run audit:ui` após mudanças visuais. Exceções intencionais devem ser documentadas inline com `/* sona-allow: <ID> */`.

---

## 3. Disciplina de Testes & Chaos Engineering

- Toda correção de bug ou nova funcionalidade deve incluir teste automatizado correspondente.
- Alterações em `etl/`, `api/_lib/resume_engine.js`, `api/fetch-jd.js` ou `servidor.js` devem preservar 100% verdes as suítes normais e adversariais (`tests/resume_engine.chaos.test.js` e `tests_py/test_etl_chaos.py`).
- Nunca enfraquecer um critério de teste existente para fazê-lo passar.
