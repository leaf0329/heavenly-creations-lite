param(
  [switch]$ConfirmCreate,
  [switch]$ConfirmRebuild,
  [string]$PostgresRoot = 'C:\Program Files\PostgreSQL\17',
  [int]$Port = 55433,
  [string]$DatabaseName = 'hc_lite',
  [string]$DatabaseUser = 'hc_lite_app'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$portableRoot = Join-Path $projectRoot '.local-postgres'
$dataDirectory = Join-Path $portableRoot 'data'
$logPath = Join-Path $portableRoot 'postgres.log'
$adminSecretPath = Join-Path $portableRoot 'admin.secret'
$envPath = Join-Path $projectRoot '.env.local'
$bin = Join-Path $PostgresRoot 'bin'
$initDb = Join-Path $bin 'initdb.exe'
$pgCtl = Join-Path $bin 'pg_ctl.exe'
$psql = Join-Path $bin 'psql.exe'
$createdb = Join-Path $bin 'createdb.exe'

if (-not $ConfirmCreate -and -not $ConfirmRebuild) { throw 'Use -ConfirmCreate or -ConfirmRebuild.' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Portable PostgreSQL port is invalid.' }
if ($DatabaseName -notmatch '^[a-z_][a-z0-9_]*$' -or $DatabaseUser -notmatch '^[a-z_][a-z0-9_]*$') { throw 'Invalid database identifier.' }
foreach ($file in @($initDb, $pgCtl, $psql, $createdb)) { if (-not (Test-Path -LiteralPath $file)) { throw "Missing PostgreSQL binary: $file" } }

function New-RandomHex([int]$bytes) {
  $buffer = [byte[]]::new($bytes)
  [Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return ([Convert]::ToHexString($buffer)).ToLowerInvariant()
}
function New-RandomBase64([int]$bytes) {
  $buffer = [byte[]]::new($bytes)
  [Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToBase64String($buffer)
}

$resolvedPortable = [IO.Path]::GetFullPath($portableRoot)
if (-not $resolvedPortable.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Portable PostgreSQL directory escaped the HCLite project.'
}

if (Test-Path -LiteralPath $dataDirectory) {
  if (-not $ConfirmRebuild) { throw 'Portable PostgreSQL already exists. Use -ConfirmRebuild to replace it.' }
  & $pgCtl stop -D $dataDirectory -m fast 2>$null | Out-Null
  if (Test-Path -LiteralPath $portableRoot) { Remove-Item -LiteralPath $portableRoot -Recurse -Force }
}

New-Item -ItemType Directory -Path $portableRoot -Force | Out-Null
$adminPassword = New-RandomHex 24
$databasePassword = New-RandomHex 24
$passwordFile = Join-Path $portableRoot 'init-password.tmp'
[IO.File]::WriteAllText($passwordFile, $adminPassword, [Text.UTF8Encoding]::new($false))
try {
  & $initDb -D $dataDirectory -U postgres --encoding=UTF8 --locale=C --auth-local=trust --auth-host=scram-sha-256 --pwfile=$passwordFile
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed.' }
} finally {
  Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue
}

$configPath = Join-Path $dataDirectory 'postgresql.conf'
[IO.File]::AppendAllText($configPath, "`r`nlisten_addresses = '127.0.0.1'`r`nport = $Port`r`nmax_connections = 30`r`n", [Text.UTF8Encoding]::new($false))
& $pgCtl start -D $dataDirectory -l $logPath -w
if ($LASTEXITCODE -ne 0) { throw 'Portable PostgreSQL failed to start.' }

$previousPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = $adminPassword
  $roleSql = "CREATE ROLE $DatabaseUser LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$databasePassword'"
  & $psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $Port -U postgres -d postgres -c $roleSql | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Application role creation failed.' }
  & $createdb -h 127.0.0.1 -p $Port -U postgres -O $DatabaseUser $DatabaseName
  if ($LASTEXITCODE -ne 0) { throw 'Application database creation failed.' }
} finally {
  $env:PGPASSWORD = $previousPassword
}

[IO.File]::WriteAllText($adminSecretPath, $adminPassword, [Text.UTF8Encoding]::new($false))
$databaseUrl = "postgresql://${DatabaseUser}:${databasePassword}@127.0.0.1:${Port}/${DatabaseName}"
$contents = @"
# Generated for HCLite's project-local PostgreSQL. Never commit.
DATABASE_URL=$databaseUrl
SESSION_SECRET=$(New-RandomHex 32)
CONFIG_ENCRYPTION_KEY=$(New-RandomBase64 32)
APP_ORIGIN=http://127.0.0.1:3000
COOKIE_SECURE=false
TRUST_PROXY=false
FFMPEG_PATH=.local-tools/ffmpeg.exe
STT_MAX_UPLOAD_BYTES=524288000
STT_MAX_CONCURRENT_PER_USER=1
TEXT_MAX_CONCURRENT_PER_USER=2
"@
[IO.File]::WriteAllText($envPath, $contents.TrimStart(), [Text.UTF8Encoding]::new($false))

$env:DATABASE_URL = $databaseUrl
Push-Location $projectRoot
try {
  & node scripts/migrate-database.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
} finally { Pop-Location }

Write-Output "HCLite portable PostgreSQL is ready on 127.0.0.1:$Port"
Write-Output "Database: $DatabaseName; role: $DatabaseUser"
