$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$dataDirectory = Join-Path $projectRoot '.local-postgres\data'
$pgCtl = 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe'
if (-not (Test-Path -LiteralPath $dataDirectory)) { Write-Output 'HCLite PostgreSQL is not initialized.'; exit 0 }
& $pgCtl status -D $dataDirectory 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Output 'HCLite PostgreSQL is already stopped.'; exit 0 }
& $pgCtl stop -D $dataDirectory -m fast -w
if ($LASTEXITCODE -ne 0) { throw 'HCLite PostgreSQL failed to stop.' }
