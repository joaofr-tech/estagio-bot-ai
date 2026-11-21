# Sona — Design System (`DESIGN.md`)

> **Fonte única de verdade visual e de UX Writing do Sona.**
> Toda tela nova ou alteração de interface DEVE herdar `design-system.css` e obedecer estritamente às regras abaixo.

---

## 1. Direção Estética (Extraída das Referências Oficiais)

1. **Superfícies & Contraste (Ref. Linear Dark):**
   - Dark Obsidian em camadas (nunca `#000000` puro chapado, nunca gradiente colorido chamativo na sidebar):
     - `--bg-sidebar`: `#0C0C0E`
     - `--bg-canvas`: `#111114`
     - `--bg-surface`: `#17171B`
     - `--bg-surface-elevated`: `#1E1E23`
     - `--bg-hover`: `#232329`
   - Bordas hairline sutis: `--border-subtle: rgba(255, 255, 255, 0.07)` e `--border-strong: rgba(255, 255, 255, 0.13)`.
   - Hierarquia tipográfica: `--text-primary: #F4F4F6`, `--text-secondary: #A1A1AA`, `--text-muted: #71717A`.
   - Acento discreto (status/indicador ativo): `--accent-dot: #4ADE80` (verde luminoso apenas em pontos de status, progresso e destaques pontuais).

2. **Botões 3D Táteis & Sensação de Luxo (Ref. Dark Tactile Buttons & Monochrome Icon):**
   - Botão primário `.sona-btn-primary`: superfície grafite metálica iluminada no topo (`linear-gradient(180deg, #34343A 0%, #242429 100%)`), highlight interno superior `inset 0 1px 0 rgba(255,255,255,0.16)`, borda `rgba(255,255,255,0.14)` e sombra 3D profunda `0 4px 12px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.65)`.
   - Botão secundário `.sona-btn-secondary`: `linear-gradient(180deg, #222227 0%, #19191D 100%)`, highlight interno `inset 0 1px 0 rgba(255,255,255,0.08)`, sombra tátil.
   - Botão ícone 3D `.sona-icon-btn`: squircle escuro com bevel sutil e ícone SVG monocromático centralizado.
   - Estado `:active`: `transform: translateY(1px)` com sombra reduzida (clique mecânico).

3. **Sidebar (Ref. Linear):**
   - Largura fixa `236px`, fundo `#0C0C0E`, borda direita `1px solid rgba(255,255,255,0.07)`.
   - Grupos discretos (`OPERAÇÃO`, `CURRÍCULO`, `INSIGHTS`), itens de `32px` de altura com ícone SVG `15px` (stroke `1.6px`) monocromático.

4. **Insights & Filtros (Ref. Insights Grid):**
   - Nome da aba analítica: **`Insights`**.
   - Barra horizontal única de pesquisa + selects de filtro inline (sem blocos empilhados).
   - Cards proporcionais em grid limpo, cada um contendo: título, número principal e gráfico/ilustração SVG minimalista.

5. **Folha de Documento (Exceção Controlada):**
   - No Estúdio de Currículo, a folha `#ats-resume-sheet` permanece branca (`#FFFFFF`) com texto `#111111` (Calibri, template `modelo-cv.docx`) flutuando sobre o canvas escuro `#111114`.

---

## 2. Regras Negativas (O que é PROIBIDO no Sona)

1. **ZERO emojis** em qualquer parte da UI (títulos, botões, badges, tabs, toasts, estados vazios). Usar somente texto limpo e ícones SVG monocromáticos (`stroke="currentColor"`).
2. **ZERO card dentro de card.** Cada informação tem no máximo 1 nível de superfície.
3. **ZERO elemento decorativo sem função:** proibido monograma de 2 letras (`TE`, `MC`) em cards de vaga, proibido kicker acima do título (`SONA · ...`) e proibido subtítulos longos. Todo cabeçalho de página tem apenas **Título + descrição objetiva de no máximo 2 linhas**.
4. **Respiro obrigatório:** mínimo `24px`–`32px` de padding em containers principais; lista de vagas limpa mostrando apenas **Cargo**, **Empresa**, **1 linha curta de metadado** e **ações literais**.
5. **Estúdio de Currículo sem ruído:** a folha do currículo ocupa o protagonismo; análise de matches/gaps fica recolhida num botão/gaveta discreta sob demanda.

---

## 3. UX Writing (Microcopy Literal — Verbo + Objeto & Title Case)

- **Capitalização (Title Case em Português):** todos os itens da sidebar, títulos de tela, títulos de cards, abas e botões usam **inicial maiúscula em cada palavra principal**, mantendo minúsculas apenas preposições/artigos curtos (`de`, `do`, `da`, `dos`, `das`, `as`, `os`, `e`, `em`, `para`). Ex.: `Meta do Dia`, `Gerador de Currículo`, `Configurar Fontes`, `Banco de Fatos`, `Histórico de Buscas`, `Parâmetros do Crawler`, `Iniciar Candidatura`, `Voltar para Abertas`.

| Evitar (Ambíguo) | Usar (Literal e Claro) |
| :--- | :--- |
| `Inscrição` (que já muda status) | **`Ver Vaga`** (só abre link) + **`Iniciar Candidatura`** (move para Em Andamento) |
| `Reabrir` | **`Abrir Link`** |
| `Desistir` | **`Voltar para Abertas`** |
| `Currículo ATS ✨` | **`Gerar Currículo`** (ou **`Ver Currículo`** se já salvo) |
| `Indicadores` | **`Insights`** |
| `Painel de Transparência` | **`Análise de Aderência`** (recolhido por padrão) |
