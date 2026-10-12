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
Voce e o Agente de Busca de Estagios do Joao. Siga o processo:
1. Pesquise vagas novas de estagio em Engenharia de Software, Desenvolvimento, Dados ou IA (Remoto ou BH, Contagem, Ibirite, Sarzedo).
2. REGRA DE OURO PARA LINKS: Use EXATAMENTE a URL fornecida pela busca (mesmo que seja um redirecionamento do Google/Vertex). NUNCA deduza ou encurte URLs.
3. Requisitos: Aluno do 3 semestre, estuda de MANHA (precisa ser turno da tarde ou flexivel).
4. Se encontrar vagas que atendam a esses requisitos, salve-as em novas_vagas.json (array JSON puro com empresa, cargo, modalidade, requisitos, link).
5. NAO envie e-mails nesta rodada horaria! Apenas salve as vagas em novas_vagas.json.
6. Se nao houver vagas novas, apenas responda 'Nenhuma vaga nova nesta rodada.' e finalize silenciosamente.
"@

$result = agy -p $prompt --dangerously-skip-permissions
Add-Content -Path $logPath -Value $result

$end = Get-Date
$duration = [math]::Round(($end - $start).TotalSeconds)
Add-Content -Path $logPath -Value "[$($end.ToString('dd/MM/yyyy HH:mm:ss'))] Varredura concluida em $duration s."

if (Test-Path $vagasJson) {
    node gerenciador_vagas.js salvar novas_vagas.json
    node registrar_log.js "VAGAS_SALVAS" $duration "Vagas ineditas salvas no banco para o resumo das 07:15!" novas_vagas.json
} else {
    node registrar_log.js "SEM_VAGAS" $duration "Varredura horaria realizada. Nenhuma vaga nova nesta rodada."
}
