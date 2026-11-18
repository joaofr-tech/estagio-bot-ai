param(
    [switch]$ComAgente
)

Set-Location $PSScriptRoot

$start = Get-Date
$timestamp = $start.ToString("dd/MM/yyyy HH:mm:ss")
$logPath = Join-Path $PSScriptRoot "log_execucoes.txt"

Add-Content -Path $logPath -Value "========================================================"
Add-Content -Path $logPath -Value "[$timestamp] Iniciando varredura horaria de vagas (Python ETL)..."

$vagasJson = Join-Path $PSScriptRoot "novas_vagas.json"
if (Test-Path $vagasJson) {
    Remove-Item $vagasJson -Force
}

# Carregar parametros deterministicos de busca se existirem
$configFile = Join-Path $PSScriptRoot "config_busca.json"
$modelo = "gemini-3.8-flash-medium"
$effort = "medium"
$candidato = "Joao Francisco"
$periodo = "3º periodo de Engenharia de Software"
$turnoFaculdade = "MANHA"
$turnosDisponiveis = "TARDE (12h-18h / 13h-19h), NOITE ou carga horaria FLEXIVEL de 6h"
$localizacao = "Belo Horizonte e regiao metropolitana (Belo Horizonte, Contagem, Betim, Nova Lima, Ibirite)"
$modalidadesAceitas = "Presencial em $localizacao, Hibrido ou 100% Remoto (Brasil)"
$areas = "Engenharia de Software, Desenvolvimento Web/Full Stack/Backend/Frontend/Mobile, Engenharia/Ciencia de Dados, IA e Automacao"

if (Test-Path $configFile) {
    try {
        $cfg = Get-Content $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.modelo) { $modelo = $cfg.modelo }
        if ($cfg.effort) { $effort = $cfg.effort }
        if ($cfg.candidato) { $candidato = $cfg.candidato }
        if ($cfg.periodo) { $periodo = $cfg.periodo }
        if ($cfg.turnoFaculdade) { $turnoFaculdade = $cfg.turnoFaculdade.ToUpper() }
        if ($cfg.turnosDisponiveis) { $turnosDisponiveis = ($cfg.turnosDisponiveis -join ", ") }
        if ($cfg.localizacao) { $localizacao = $cfg.localizacao }
        if ($cfg.areasInteresse) { $areas = $cfg.areasInteresse }

        $mods = @()
        if ($cfg.aceitaPresencial) { $mods += "Presencial em $localizacao" }
        if ($cfg.aceitaHibrido) { $mods += "Hibrido em $localizacao" }
        if ($cfg.aceitaRemoto) { $mods += "100% Remoto (Brasil)" }
        if ($mods.Count -gt 0) { $modalidadesAceitas = ($mods -join " OU ") }
    } catch {
        Add-Content -Path $logPath -Value "Aviso: Falha ao ler config_busca.json, usando padrao."
    }
}

# Carregar regras de mismatch e anti-padroes aprendidos
$mismatchFile = Join-Path $PSScriptRoot "regras_mismatch.json"
$regrasExclusaoTexto = ""
if (Test-Path $mismatchFile) {
    try {
        $mismatchData = Get-Content $mismatchFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($mismatchData.termosNegativos -and $mismatchData.termosNegativos.Count -gt 0) {
            $termosStr = ($mismatchData.termosNegativos -join ", ")
            $regrasExclusaoTexto += "`n   - TERMOS E CARGOS ESTRITAMENTE PROIBIDOS (MISMATCH): $termosStr"
        }
        if ($mismatchData.regrasExclusao -and $mismatchData.regrasExclusao.Count -gt 0) {
            $regrasStr = ($mismatchData.regrasExclusao | ForEach-Object { "     * $_" }) -join "`n"
            $regrasExclusaoTexto += "`n   - REGRAS NEGATIVAS APRENDIDAS PELO HISTORICO DE REJEICOES:`n$regrasStr"
        }
    } catch {
        Add-Content -Path $logPath -Value "Aviso: Falha ao ler regras_mismatch.json."
    }
}

$prompt = @"
Voce e o Agente Especialista em Busca de Estagios de TI do $candidato.
Siga estritamente este fluxo de curadoria para garantir vagas REAIS, ATIVAS e SEM DUPLICIDADES:

1. ESCOPO & PERFIL DO CANDIDATO:
   - Candidato: $candidato, estudante do $periodo.
   - Areas de Interesse: $areas.
   - Restricao Rigorosa de Horario: $candidato estuda regularmente no turno da $turnoFaculdade. Portanto, a vaga DEVE aceitar estagio no turno: $turnosDisponiveis.
   - Modalidades e Localizacao aceitas: $modalidadesAceitas.$regrasExclusaoTexto

2. VAGAS RECENTES & DETALHES DE INSCRICAO:
   - Priorize vagas publicadas RECENTEMENTE em plataformas ativas como Gupy, LinkedIn Jobs, Lever, Greenhouse, Catho, Vagas.com ou sites oficiais das empresas.
   - FILTRO RIGOROSO DE MISMATCH: NUNCA traga vagas que se enquadrem nos termos proibidos ou regras negativas acima.
   - Forneca a URL real e direta da pagina de candidatura / inscricao (ex: https://empresa.gupy.io/job/... ou https://linkedin.com/jobs/view/...).
   - Capture o prazo ou status da inscricao (ex: 'Inscricoes Abertas', 'Prazo: 15/11', 'Fluxo continuo').
   - Identifique com clareza o turno exigido e a localizacao exata da vaga.

3. FORMATO DE SAIDA:
   - Se encontrar novas vagas compativeis e ativas, salve-as EXATAMENTE em 'novas_vagas.json' como um array JSON puro contendo:
     [
       {
         "empresa": "Nome da Empresa",
         "cargo": "Titulo do Cargo de Estagio",
         "modalidade": "Remoto" ou "Presencial" ou "Hibrido",
         "localizacao": "Belo Horizonte/MG (Bairro)", "Remoto - Brasil", etc.,
         "turno": "Tarde (13h-19h)" ou "Noite" ou "Flexivel (6h)",
         "prazo": "Inscricoes Abertas",
         "requisitos": "Requisitos tecnicos e qualificacoes",
         "link": "URL direta da candidatura"
       }
     ]
   - Se nao encontrar vagas novas e ativas com esses requisitos nesta rodada, apenas responda 'Nenhuma vaga nova nesta rodada.' e finalize silenciosamente sem criar o arquivo.
"@

# 1. Orquestrador oficial do Pipeline ETL em Python (sempre executa primeiro e rapido)
$env:PYTHONUTF8 = "1"
Add-Content -Path $logPath -Value "[$((Get-Date).ToString('dd/MM/yyyy HH:mm:ss'))] Executando pipeline ETL em Python (python -m etl.pipeline)..."
python -m etl.pipeline >> $logPath 2>&1

# 2. Verificacao de e-mails para acoes pendentes (Testes / Entrevistas)
Add-Content -Path $logPath -Value "[$((Get-Date).ToString('dd/MM/yyyy HH:mm:ss'))] Verificando e-mails para acoes pendentes (testes/entrevistas)..."
node verificar_emails.js >> $logPath 2>&1

# 3. Passagem complementar opcional via agente (somente quando executado com -ComAgente)
if ($ComAgente -and (Get-Command agy -ErrorAction SilentlyContinue)) {
    Add-Content -Path $logPath -Value "[$((Get-Date).ToString('dd/MM/yyyy HH:mm:ss'))] Executando busca complementar do agente (-ComAgente) com modelo: $modelo..."
    try {
        $result = $prompt | agy --model $modelo --effort $effort --dangerously-skip-permissions 2>&1
        $exitCode = $LASTEXITCODE
        Add-Content -Path $logPath -Value $result
        if ($exitCode -eq 0 -and (Test-Path $vagasJson)) {
            python -m etl.pipeline >> $logPath 2>&1
        }
    } catch {
        Add-Content -Path $logPath -Value "[$((Get-Date).ToString('dd/MM/yyyy HH:mm:ss'))] Aviso: Falha no agente complementar ($_)."
    }
}

$end = Get-Date
$duration = [math]::Round(($end - $start).TotalSeconds)
Add-Content -Path $logPath -Value "[$($end.ToString('dd/MM/yyyy HH:mm:ss'))] Ciclo ETL completo concluido em $duration s."

