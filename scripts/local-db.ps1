param([ValidateSet('setup','start','stop','status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
# ASCII relative paths avoid Windows PostgreSQL command-line encoding issues.
$localRoot = '.local'
$dataRoot = Join-Path $localRoot 'postgres'
$binRoot = if ($env:POSTGRES_BIN) { $env:POSTGRES_BIN } else { 'C:\Program Files\PostgreSQL\18\bin' }
if (!(Test-Path -LiteralPath (Join-Path $binRoot 'pg_ctl.exe'))) { throw 'Install PostgreSQL or set POSTGRES_BIN to its bin directory.' }
if ($Action -eq 'setup') {
  New-Item -ItemType Directory -Force -Path $localRoot | Out-Null
  if (!(Test-Path -LiteralPath (Join-Path $dataRoot 'PG_VERSION'))) {
    if (Test-Path -LiteralPath (Join-Path $projectRoot '.env')) { throw 'An .env already exists. Configure the local cluster manually; existing credentials will not be replaced.' }
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $randomBytes = New-Object byte[] 32
    $rng.GetBytes($randomBytes)
    $dbPassword = [BitConverter]::ToString($randomBytes).Replace('-', '')
    $rng.GetBytes($randomBytes)
    $visitorSecret = [BitConverter]::ToString($randomBytes).Replace('-', '')
    $rng.Dispose()
    $passwordFile = Join-Path $localRoot 'init-password'
    [IO.File]::WriteAllText((Join-Path $projectRoot $passwordFile), $dbPassword)
    try {
      & (Join-Path $binRoot 'initdb.exe') -D $dataRoot -U sliper_local --encoding=UTF8 --locale=C --auth=scram-sha-256 --pwfile=$passwordFile
      if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
      Add-Content -LiteralPath (Join-Path $dataRoot 'postgresql.conf') -Value "`nlisten_addresses = '127.0.0.1'`nport = 55432"
      $dbUrl = "postgresql://sliper_local:${dbPassword}@127.0.0.1:55432/sliper_dev"
      $envText = "DATABASE_URL=$dbUrl`nMIGRATION_DATABASE_URL=$dbUrl`nVISITOR_HASH_SECRET=$visitorSecret`nSLIPER_AUTH_MODE=development`nLOCAL_DATABASE=1`nAPP_ORIGIN=http://127.0.0.1:3000`n"
      [IO.File]::WriteAllText((Join-Path $projectRoot '.env'), $envText)
    } finally { Remove-Item -LiteralPath $passwordFile -ErrorAction SilentlyContinue }
  }
}
if ($Action -eq 'stop') { & (Join-Path $binRoot 'pg_ctl.exe') -D $dataRoot -m fast -w stop; exit $LASTEXITCODE }
& (Join-Path $binRoot 'pg_ctl.exe') -D $dataRoot status
$running = $LASTEXITCODE -eq 0
if ($Action -eq 'status') { if ($running) { exit 0 } else { exit 1 } }
if (!$running) {
  # pg_ctl detaches the server and writes its output to a project-local log.
  & (Join-Path $binRoot 'pg_ctl.exe') -D $dataRoot -l (Join-Path $localRoot 'postgres.log') -w start
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL failed to start; inspect .local/postgres.log' }
}
Write-Output 'Sliper PostgreSQL is running on 127.0.0.1:55432.'
