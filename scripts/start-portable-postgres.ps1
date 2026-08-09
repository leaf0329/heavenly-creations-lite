$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$dataDirectory = Join-Path $projectRoot '.local-postgres\data'
$logPath = Join-Path $projectRoot '.local-postgres\postgres.log'
$pgCtl = 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe'
if (-not (Test-Path -LiteralPath $dataDirectory)) { throw 'Run setup-portable-postgres.ps1 first.' }
& $pgCtl status -D $dataDirectory 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Output 'HCLite PostgreSQL is already running.'; exit 0 }
& $pgCtl start -D $dataDirectory -l $logPath -w
if ($LASTEXITCODE -ne 0) { throw 'HCLite PostgreSQL failed to start.' }
