$projectDir = $PSScriptRoot

$actionBusca = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$projectDir\executar_busca.ps1`"" -WorkingDirectory $projectDir
$triggerBusca = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "BuscaVagasEstagio" -Action $actionBusca -Trigger $triggerBusca -Force

$actionResumo = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$projectDir\executar_resumo_diario.ps1`"" -WorkingDirectory $projectDir
$triggerResumo = New-ScheduledTaskTrigger -Daily -At "07:15"
Register-ScheduledTask -TaskName "ResumoDiarioEstagio" -Action $actionResumo -Trigger $triggerResumo -Force

Write-Host "Tarefas agendadas com sucesso no Windows!" -ForegroundColor Green
