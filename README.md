# 🚀 EstágioBot AI

Agente autônomo baseado no **Google Antigravity CLI** que realiza buscas contínuas na internet por vagas de estágio (Engenharia de Software, Dados e IA), armazena oportunidades inéditas em um banco local e envia um **Resumo Matinal diário às 07:15** com template em **React Email**.

---

## 📁 Estrutura do Projeto

```text
├── dashboard.html             # Painel visual local (abra com 2 cliques no navegador)
├── EmailTemplate.jsx          # Template React estilizado das vagas (Grid moderno)
├── gerenciador_vagas.js       # Controle do banco de dados local e deduplicação
├── disparar_resumo_diario.js  # Compila e envia o e-mail matinal com as vagas acumuladas
├── executar_busca.ps1         # Script que acorda a IA a cada hora para varrer a internet
├── executar_resumo_diario.ps1 # Script disparado às 07:15 para despachar o e-mail
├── agendar_tarefas.ps1        # Script para registrar as duas rotinas no Windows em 1 clique
├── banco_vagas.json           # Armazenamento persistente de todas as vagas encontradas
├── .env.example               # Modelo das variáveis de ambiente
├── .gitignore                 # Arquivos ignorados no Git (node_modules, .env, etc.)
└── package.json               # Dependências do Node.js
```

---

## ⚡ Como Usar

### 1. Pré-requisitos
* [Node.js](https://nodejs.org/) (v18+)
* [Google Antigravity CLI](https://antigravity.google/) instalado (`agy`)
* Conta Gmail com **Senha de Aplicativo (16 dígitos)** configurada

### 2. Instalação
Clone o repositório e instale as dependências:
```bash
git clone https://github.com/seu-usuario/automacao-busca-vagas.git
cd automacao-busca-vagas
npm install
```

### 3. Configurar Credenciais
Crie o arquivo `.env` a partir do exemplo:
```bash
cp .env.example .env
```
Abra o `.env` e preencha:
```env
EMAIL_ADDRESS=seu_email@gmail.com
EMAIL_PASSWORD=sua_senha_de_app_de_16_digitos
```

### 4. Ativar o Agendador Automático (Windows)
Abra o PowerShell na pasta do projeto e execute:
```powershell
powershell -ExecutionPolicy Bypass -File .\agendar_tarefas.ps1
```

Pronto! O Windows agora cuidará de tudo:
1. **A cada 1 hora:** O robô varre a internet silenciosamente e salva novas vagas no banco local.
2. **Todo dia às 07:15:** Você recebe um e-mail consolidado com todas as vagas acumuladas nas últimas 24h.

---

## 📊 Painel de Observabilidade Local
Dê **dois cliques** no arquivo `dashboard.html` para abrir o painel no seu navegador:
* Status em tempo real do robô.
* Quantidade de varreduras realizadas.
* Todas as vagas encontradas disponíveis para consulta imediata com links diretos.

---

## 📄 Licença
Distribuído sob a licença [MIT](LICENSE).
