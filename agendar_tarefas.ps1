$projectDir = $PSScriptRoot

Unregister-ScheduledTask -TaskName "ResumoDiarioEstagio" -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "NotificarNoBootEstagio" -Confirm:$false -ErrorAction SilentlyContinue

$actionBusca = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$projectDir\executar_busca.ps1`"" -WorkingDirectory $projectDir
$triggerBusca = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 9999)
$settingsBusca = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "BuscaVagasEstagio" -Action $actionBusca -Trigger $triggerBusca -Settings $settingsBusca -Force

Write-Host "Tarefa BuscaVagasEstagio registrada com sucesso!" -ForegroundColor Green
