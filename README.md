# 🎯 Radar de Oportunidades & Estágios (EstágioBot)

Um sistema autônomo e minimalista (estilo editorial *Paper & Ink*) para **descoberta, monitoramento e gestão de candidaturas de estágio em tecnologia** (Engenharia de Software, Dados, IA e Web).

Inclui um **Dashboard Local** completo com acompanhamento de metas diárias, funil de candidaturas, parâmetros determinísticos de busca por cidade/turno e métricas de eficiência (KPIs).

---

## ⚡ Início Rápido (Sem Instalação Complexa)

### 1. Visualizar o Painel
Para ver suas vagas e gerenciar candidaturas, você só precisa dar **dois cliques** no arquivo:
* **[dashboard.html](dashboard.html)** (ou [index.html](index.html)) em qualquer navegador.

Não precisa de servidor web nem banco de dados externo — funciona **100% localmente**.

---

## 🚀 Como Usar o Crawler (Busca Automática)

### 1. Pré-requisitos
* [Node.js](https://nodejs.org/) (versão 18 ou superior)
* Windows com PowerShell
* [Google Antigravity CLI](https://antigravity.google/) (`agy`) para a IA fazer a varredura autônoma na web

### 2. Instalação das Dependências
Clone o repositório e instale os pacotes:
```bash
git clone https://github.com/seu-usuario/automacao-busca-vagas.git
cd automacao-busca-vagas
npm install
```

### 3. Personalizar seus Parâmetros de Busca
Você pode configurar seus parâmetros de duas formas:
1. **Pelo Dashboard:** Abra a tela **`04 / Parâmetros de Busca`** no navegador, selecione seu estado, cidades, turno de estudo e clique em *Salvar*.
2. **Direto no arquivo:** Edite o arquivo `config_busca.json`:
```json
{
  "candidato": "Seu Nome",
  "periodo": "3º período de Engenharia de Software",
  "turnoFaculdade": "Manhã",
  "turnosDisponiveis": ["Tarde (12h-18h / 13h-19h)", "Flexível (6h)"],
  "estado": "MG",
  "cidades": ["Belo Horizonte", "Contagem", "Betim", "Nova Lima"],
  "aceitaPresencial": true,
  "aceitaHibrido": true,
  "aceitaRemoto": true,
  "areasInteresse": "Engenharia de Software, Dados, IA e Desenvolvimento Web"
}
```

### 4. Executar uma Varredura Manual
Para rodar uma busca agora mesmo:
```powershell
powershell -ExecutionPolicy Bypass -File .\executar_busca.ps1
```
* O robô lê suas preferências no `config_busca.json`.
* Varre as principais plataformas (Gupy, LinkedIn, Catho, portais oficiais).
* Valida links diretos e salva apenas vagas inéditas no `banco_vagas.json`.

### 5. Ativar Varredura Automática (Agendador do Windows)
Para que o bot rode de forma autônoma de hora em hora em segundo plano:
```powershell
powershell -ExecutionPolicy Bypass -File .\agendar_tarefas.ps1
```
> **Nota:** Se o computador estiver desligado na hora cheia, o Windows executa a busca automaticamente assim que o sistema for ligado.

---

## 🧭 As 5 Telas do Dashboard

| Tela | O que faz |
| :--- | :--- |
| **01 / Meta do Dia** | Exibe as **3 vagas prioritárias de hoje** com medidor de meta diária + o catálogo de **todas as vagas abertas**. Clicar em *Inscrição ↗* abre o link oficial e move a vaga para *Em Andamento*. |
| **02 / Candidaturas** | Gerencie suas vagas em 3 sub-abas: **Em Andamento** (com botão *Confirmar Candidatura ✓* que cronometra o tempo gasto), **Aplicadas/Concluídas** e **Salvas ★**. |
| **03 / Histórico** | Log imutável de telemetria das varreduras (timestamp, duração em segundos e quantidade de novas vagas encontradas). |
| **04 / Parâmetros** | Ajuste determinístico do crawler: escolha seu estado para carregar cidades em caixas de seleção, defina turnos disponíveis e modalidades aceitas. |
| **05 / Indicadores (KPIs)** | Gráfico quinzenal de candidaturas diárias em linha (com linha de meta 3/dia), tempo médio gasto por vaga, taxa de conclusão, funil com vagas encerradas sem candidatura e distribuição por especialidade (Backend, Frontend, Dados, IA, QA). |

---

## 🧪 Suíte de Testes Automatizados

O projeto possui testes automatizados cobrindo fluxo de candidaturas, integridade dos indicadores e parâmetros do crawler.

Para rodar todos os testes:
```bash
npm test
```

---

## 📁 Estrutura de Arquivos

```text
├── dashboard.html             # Painel visual editorial principal
├── index.html                 # Espelho do dashboard (para GitHub Pages / Web)
├── config_busca.json          # Configuração determinística lida pelo crawler
├── config_busca.js            # Bridge de parâmetros para o dashboard
├── banco_vagas.json           # Banco de dados local com todas as vagas
├── banco_vagas.js             # Bridge de dados para o dashboard
├── historico_execucoes.js     # Histórico de execuções do robô
├── executar_busca.ps1         # Script PowerShell que orquestra a busca autônoma
├── gerenciador_vagas.js       # Deduplicação canônica e persistência das vagas
├── verificar_vagas_encerradas.js # Rotina de limpeza de vagas expiradas
├── agendar_tarefas.ps1        # Agendador de tarefas do Windows
├── tests/                     # Suíte de testes automatizados (npm test)
│   ├── candidaturas.test.js
│   ├── indicadores.test.js
│   ├── parametros.test.js
│   ├── crawler_gerenciador.test.js
│   └── run_all_tests.js
├── legacy/                    # Arquivos e testes exploratórios arquivados
└── package.json               # Dependências e scripts Node.js
```

---

## ✉️ Notificações por E-mail (Opcional)

Se desejar receber alertas no e-mail a cada nova vaga encontrada:
1. Copie o arquivo de exemplo:
   ```bash
   cp .env.example .env
   ```
2. Insira suas credenciais de e-mail (Gmail com senha de app de 16 dígitos):
   ```env
   EMAIL_ADDRESS=seu_email@gmail.com
   EMAIL_PASSWORD=sua_senha_de_app_16_digitos
   ```

---

## 📄 Licença
Distribuído sob a licença [MIT](LICENSE).
