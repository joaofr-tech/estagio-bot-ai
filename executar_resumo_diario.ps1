Set-Location $PSScriptRoot

$logPath = Join-Path $PSScriptRoot "log_execucoes.txt"
$timestamp = (Get-Date).ToString("dd/MM/yyyy HH:mm:ss")

Add-Content -Path $logPath -Value "========================================================"
Add-Content -Path $logPath -Value "[$timestamp] [07:15] Executando rotina do Resumo Matinal..."

node disparar_resumo_diario.js >> $logPath 2>&1
