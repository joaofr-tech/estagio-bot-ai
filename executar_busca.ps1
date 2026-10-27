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

$prompt = @"
Voce e o Agente Especialista em Busca de Estagios de TI do Joao.
Siga estritamente este fluxo de curadoria para garantir vagas REAIS, ATIVAS e SEM DUPLICIDADES:

1. ESCOPO & PERFIL:
   - Areas: Engenharia de Software, Desenvolvimento Web/Full Stack/Mobile, Engenharia/Ciencia de Dados, Inteligencia Artificial/Automacao.
   - Localizacao: Remoto (Brasil) ou Presencial/Hibrido em Belo Horizonte e regiao metropolitana (Contagem, Betim, Ibirite, Sarzedo).
   - Requisito obrigatorio de horario: Joao estuda no turno da MANHA (3º periodo de Engenharia de Software). A vaga DEVE ser no turno da TARDE (ex: 12h-18h, 13h-19h) ou com carga horaria FLEXIVEL de 6h diarias.

2. VAGAS RECENTES & ATIVAS (EVITE VAGAS EXPIRADAS):
   - Priorize vagas publicadas RECENTEMENTE (ultimas 24 a 72 horas / semana corrente) em plataformas ativas como Gupy, LinkedIn Jobs, Lever, Greenhouse, Catho, Vagas.com ou sites de carreiras das empresas.
   - Ignore postagens antigas de semanas/meses atras que provavelmente ja foram preenchidas ou encerradas.

3. LINKS DIRETOS & VALIDOS:
   - Forneca a URL real e direta da pagina de candidatura (ex: https://empresa.gupy.io/job/... ou https://linkedin.com/jobs/view/...).
   - Se o resultado vier com redirecionamento de busca, extraia e use o link direto da pagina da vaga para evitar links quebrados ou expirados.

4. FORMATO DE SAIDA:
   - Se encontrar novas vagas compativeis e ativas, salve-as EXATAMENTE em 'novas_vagas.json' como um array JSON puro contendo:
     [ { "empresa": "...", "cargo": "...", "modalidade": "...", "requisitos": "...", "link": "..." } ]
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
