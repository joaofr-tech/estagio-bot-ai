Set-Location $PSScriptRoot

$start = Get-Date
$timestamp = $start.ToString("dd/MM/yyyy HH:mm:ss")
$logPath = Join-Path $PSScriptRoot "log_execucoes.txt"

Add-Content -Path $logPath -Value "========================================================"
Add-Content -Path $logPath -Value "[$timestamp] Iniciando varredura horaria de vagas..."

$vagasJson = Join-Path $PSScriptRoot "novas_vagas.json"
if (Test-Path $vagasJson) {
    Remove-Item $vagasJson -Force
}

# Carregar parametros deterministicos de busca se existirem
$configFile = Join-Path $PSScriptRoot "config_busca.json"
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

$result = agy -p $prompt --dangerously-skip-permissions
Add-Content -Path $logPath -Value $result

$end = Get-Date
$duration = [math]::Round(($end - $start).TotalSeconds)
Add-Content -Path $logPath -Value "[$($end.ToString('dd/MM/yyyy HH:mm:ss'))] Varredura concluida em $duration s."

if (Test-Path $vagasJson) {
    node gerenciador_vagas.js salvar novas_vagas.json
    node registrar_log.js "VAGAS_SALVAS" $duration "Novas oportunidades catalogadas!" novas_vagas.json
    node enviar_vagas_pendentes.js >> $logPath 2>&1
} else {
    node registrar_log.js "SEM_VAGAS" $duration "Varredura realizada. Nenhuma vaga nova nesta rodada."
}

# Auditoria automatica de encerramento em vagas abertas (LinkedIn, Gupy, portais)
Add-Content -Path $logPath -Value "[$((Get-Date).ToString('dd/MM/yyyy HH:mm:ss'))] Auditando status de encerramento das vagas em aberto..."
node verificar_vagas_encerradas.js 30 >> $logPath 2>&1

# Sincronizacao automatica com GitHub Pages
Add-Content -Path $logPath -Value "[$((Get-Date).ToString('dd/MM/yyyy HH:mm:ss'))] Sincronizando dados com o GitHub Pages..."
try {
    Copy-Item -Path (Join-Path $PSScriptRoot "dashboard.html") -Destination (Join-Path $PSScriptRoot "index.html") -Force
    git -C $PSScriptRoot add banco_vagas.* historico_execucoes.* regras_mismatch.* index.html dashboard.html
    $pendingChanges = git -C $PSScriptRoot status --porcelain
    if ($pendingChanges) {
        git -C $PSScriptRoot commit -m "Auto: atualização diária de vagas e métricas [skip ci]"
        git -C $PSScriptRoot push origin main
        Add-Content -Path $logPath -Value "[$((Get-Date).ToString('dd/MM/yyyy HH:mm:ss'))] GitHub Pages atualizado com sucesso via git push!"
    } else {
        Add-Content -Path $logPath -Value "[$((Get-Date).ToString('dd/MM/yyyy HH:mm:ss'))] Repositorio ja sincronizado."
    }
} catch {
    Add-Content -Path $logPath -Value "[$((Get-Date).ToString('dd/MM/yyyy HH:mm:ss'))] Falha na sincronizacao com GitHub Pages: $_"
}

