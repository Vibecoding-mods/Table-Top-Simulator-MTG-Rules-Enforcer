# Stops the hidden bridge started by tools\start-bridge.ps1 (the restart loop first, then node).
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like '*bridge-loop.cmd*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*bridge-loop.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*bridge.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
"bridge stopped"
