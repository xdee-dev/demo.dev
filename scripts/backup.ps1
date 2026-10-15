# Backup database + uploaded files (Windows PowerShell).
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
# Schedule daily with Windows Task Scheduler. Requires pg_dump in PATH (PostgreSQL\16\bin).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
$dbUrl = (Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
$storage = (Get-Content $envFile | Where-Object { $_ -match '^STORAGE_DIR=' }) -replace '^STORAGE_DIR=', ''
if (-not $storage) { $storage = "./storage" }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dest = Join-Path $root "backups"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$dump = Join-Path $dest "rental-db-$stamp.dump"
& pg_dump --format=custom --no-owner --file="$dump" "$dbUrl"
Write-Host "Database  -> $dump"
$storagePath = Join-Path (Join-Path $root "server") $storage
if (Test-Path $storagePath) {
  $zip = Join-Path $dest "rental-files-$stamp.zip"
  Compress-Archive -Path "$storagePath\*" -DestinationPath $zip -Force
  Write-Host "Files     -> $zip"
}
# keep the 30 most recent backups of each kind
Get-ChildItem $dest -Filter "rental-db-*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item
Get-ChildItem $dest -Filter "rental-files-*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item
