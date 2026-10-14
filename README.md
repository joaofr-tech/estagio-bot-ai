# 🚀 EstágioBot AI

Agente autônomo baseado no **Google Antigravity CLI** que realiza buscas contínuas por vagas de estágio em Engenharia de Software, Dados e Inteligência Artificial. Filtra automaticamente oportunidades compatíveis com quem estuda no turno da manhã, alimenta um **Dashboard Local** minimalista e dispara notificações por **e-mail em React** sempre que novas vagas são encontradas.

---

## 📁 Estrutura do Projeto

```text
├── dashboard.html             # Painel visual minimalista (abra com 2 cliques no navegador)
├── EmailTemplate.jsx          # Template React estilizado para e-mails (JSX Email)
├── enviar_vagas_pendentes.js  # Disparador de e-mail para vagas inéditas
├── gerenciador_vagas.js       # Gerenciamento do banco local e deduplicação
├── registrar_log.js           # Registro de métricas e auditoria da IA
├── banco_vagas.json           # Banco de dados local com todas as vagas catalogadas
├── banco_vagas.js             # Bridge de dados para o dashboard
├── historico_execucoes.js     # Histórico de varreduras e observabilidade
├── executar_busca.ps1         # Script de execução horária acionado pelo Windows
├── agendar_tarefas.ps1        # Script para registrar a rotina no Windows em 1 clique
├── .env.example               # Modelo para variáveis de ambiente
├── .gitignore                 # Arquivos ignorados pelo Git (node_modules, .env, etc.)
└── package.json               # Dependências do projeto (Node.js)
```

---

## ⚡ Como Usar

### 1. Pré-requisitos
* [Node.js](https://nodejs.org/) (versão 18 ou superior)
* [Google Antigravity CLI](https://antigravity.google/) instalado (`agy`)
* Sistema operacional Windows (com PowerShell)
* Conta Gmail com **Senha de Aplicativo (16 dígitos)** configurada (para envio de e-mails)

### 2. Instalação
Clone o repositório e instale as dependências:
```bash
git clone https://github.com/seu-usuario/automacao-busca-vagas.git
cd automacao-busca-vagas
npm install
```

### 3. Configurar Credenciais de E-mail
Copie o arquivo `.env.example` para `.env`:
```bash
cp .env.example .env
```
Preencha suas informações no `.env`:
```env
EMAIL_ADDRESS=seu_email@gmail.com
EMAIL_PASSWORD=sua_senha_de_app_de_16_digitos
```

### 4. Ativar o Agendador no Windows
Execute o script no PowerShell para agendar a rotina automática:
```powershell
powershell -ExecutionPolicy Bypass -File .\agendar_tarefas.ps1
```

O Windows cuidará do resto:
* **De hora em hora:** A IA varre a internet silenciosamente em busca de novas vagas.
* **Notificação imediata:** Se encontrar vagas inéditas, salva no banco local e dispara o e-mail em React.
* **Silêncio se não houver novidades:** Nenhuma notificação desnecessária é gerada.
* **Auto-Recuperação:** Se o PC estiver desligado na hora cheia, a busca roda assim que o computador ligar (`StartWhenAvailable`).

---

## 📊 Dashboard de Vagas & Observabilidade
Dê **dois cliques** no arquivo `dashboard.html`:
* Design minimalista com paleta em tom off-white e verde escuro (`#235347`).
* Visualização de todas as oportunidades salvas com links diretos e verificados.
* Busca rápida por tecnologias (`Python`, `SQL`, `IA generativa`, etc.) e filtros (`Remoto`, `BH`).
* Aba de histórico com auditoria detalhada de cada ciclo da IA (tempo de execução, status e logs).
* Auto-atualização inteligente no foco da aba ou a cada 60 segundos.

---

## 📄 Licença
Distribuído sob a licença [MIT](LICENSE).
