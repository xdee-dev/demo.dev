# Restore a backup made by backup.ps1 INTO AN EMPTY DATABASE.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 -Dump backups\rental-db-YYYYMMDD-HHMMSS.dump [-Files backups\rental-files-....zip]
param([Parameter(Mandatory=$true)][string]$Dump, [string]$Files)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dbUrl = (Get-Content (Join-Path $root ".env") | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
& pg_restore --no-owner --exit-on-error --dbname="$dbUrl" "$Dump"
Write-Host "Database restored from $Dump"
if ($Files) { Expand-Archive -Path $Files -DestinationPath (Join-Path $root "server\storage") -Force; Write-Host "Files restored" }
