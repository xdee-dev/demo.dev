# ============================================================================
#  Setup otomatis Rental Management System untuk Windows
#  Dijalankan oleh 1-SETUP.bat. Aman dijalankan ulang.
# ============================================================================
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($n, $text) { Write-Host ""; Write-Host "[$n] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Fail($text) {
  Write-Host ""
  Write-Host "GAGAL: $text" -ForegroundColor Red
  Write-Host ""
  Read-Host "Tekan Enter untuk menutup"
  exit 1
}

Write-Host "=============================================================" -ForegroundColor Yellow
Write-Host "   SETUP RENTAL MANAGEMENT SYSTEM" -ForegroundColor Yellow
Write-Host "=============================================================" -ForegroundColor Yellow

# ---------------------------------------------------------------- 1. Node.js
Step 1 "Memeriksa Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js tidak ditemukan. Instal Node.js 22 LTS dari https://nodejs.org lalu restart komputer." }
$nodeVer = (& node -v).Trim()
$major = [int]($nodeVer.TrimStart('v').Split('.')[0])
if ($major -lt 20) { Fail "Versi Node.js Anda $nodeVer terlalu lama. Instal Node.js 22 LTS dari https://nodejs.org" }
Ok "Node.js $nodeVer"

# ---------------------------------------------------------------- 2. PostgreSQL
Step 2 "Mencari PostgreSQL (psql)"
$psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $psql) {
  $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe", "C:\Program Files (x86)\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending | Select-Object -First 1
  if ($found) { $psql = $found.FullName }
}
if (-not $psql) { Fail "psql.exe tidak ditemukan. Pastikan PostgreSQL terinstal (folder C:\Program Files\PostgreSQL)." }
$pgBin = Split-Path -Parent $psql
$env:Path = "$pgBin;$env:Path"
Ok $psql

# ---------------------------------------------------------------- 3. Koneksi admin
Step 3 "Koneksi ke PostgreSQL"
Write-Host "    Masukkan password user 'postgres' yang Anda buat saat menginstal PostgreSQL."
$port = Read-Host "    Port PostgreSQL (tekan Enter untuk 5432)"
if (-not $port) { $port = "5432" }
if ($env:RENTAL_PG_PASSWORD) { $adminPw = $env:RENTAL_PG_PASSWORD } else {
  $sec = Read-Host "    Password postgres" -AsSecureString
  $adminPw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
$env:PGPASSWORD = $adminPw
& $psql -h localhost -p $port -U postgres -d postgres -tAc "select 1" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Fail "Tidak bisa login ke PostgreSQL. Periksa: (1) password postgres benar, (2) port benar, (3) service PostgreSQL berjalan (buka 'Services' di Windows, cari 'postgresql', klik Start)."
}
Ok "Login sebagai postgres berhasil"

# ---------------------------------------------------------------- 4. Role & database
Step 4 "Membuat user database 'rental_app' dan database 'rental_db'"
$envFile = Join-Path $root ".env"
$appPw = $null
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=postgres://rental_app:([^@]+)@' } | Select-Object -First 1
  if ($line -and ($line -match '^DATABASE_URL=postgres://rental_app:([^@]+)@')) { $appPw = $Matches[1] }
}
if (-not $appPw) {
  $chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $appPw = -join (1..24 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
}
$sql = @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rental_app') THEN
    CREATE ROLE rental_app LOGIN PASSWORD '$appPw' NOSUPERUSER NOCREATEROLE NOBYPASSRLS CREATEDB;
  ELSE
    ALTER ROLE rental_app WITH LOGIN PASSWORD '$appPw' NOSUPERUSER NOBYPASSRLS;
  END IF;
END `$`$;
SELECT 'CREATE DATABASE rental_db OWNER rental_app ENCODING ''UTF8'' TEMPLATE template0' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'rental_db')\gexec
SELECT 'CREATE DATABASE rental_test OWNER rental_app ENCODING ''UTF8'' TEMPLATE template0' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'rental_test')\gexec
"@
$tmp = Join-Path ([IO.Path]::GetTempPath()) "rental-setup.sql"
Set-Content -Path $tmp -Value $sql -Encoding ASCII
& $psql -h localhost -p $port -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f $tmp
$code = $LASTEXITCODE
Remove-Item $tmp -ErrorAction SilentlyContinue
$env:PGPASSWORD = $null
if ($code -ne 0) { Fail "Gagal membuat user/database. Lihat pesan error di atas." }
Ok "User rental_app dan database rental_db siap"

# ---------------------------------------------------------------- 5. .env
Step 5 "Menulis file konfigurasi .env"
$envContent = @"
NODE_ENV=development
PORT=4000
DATABASE_URL=postgres://rental_app:$appPw@localhost:$port/rental_db
TEST_DATABASE_URL=postgres://rental_app:$appPw@localhost:$port/rental_test
APP_URL=http://localhost:5173
SESSION_TTL_HOURS=12
STORAGE_DIR=./storage
MAX_UPLOAD_MB=5
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=Rental Management System <no-reply@localhost>
SEED_DEMO_PASSWORD=DemoRental2026
"@
Set-Content -Path $envFile -Value $envContent -Encoding ASCII
Ok ".env dibuat"

# ---------------------------------------------------------------- 6. npm install
Step 6 "Menginstal paket aplikasi (npm install) - bisa beberapa menit, perlu internet"
& npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail "npm install gagal. Periksa koneksi internet lalu jalankan 1-SETUP.bat lagi." }
Ok "Paket terinstal"

# ---------------------------------------------------------------- 7. migrasi + data demo
Step 7 "Membuat tabel database"
& npm run db:migrate
if ($LASTEXITCODE -ne 0) { Fail "Migrasi database gagal. Lihat pesan error di atas." }
Ok "Tabel dibuat"

Step 8 "Mengisi data contoh dan akun demo"
& npm run db:seed
if ($LASTEXITCODE -ne 0) { Fail "Pengisian data demo gagal. Lihat pesan error di atas." }

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Green
Write-Host "   SETUP SELESAI" -ForegroundColor Green
Write-Host "=============================================================" -ForegroundColor Green
Write-Host "   Langkah berikutnya: klik dua kali  2-JALANKAN-APLIKASI.bat"
Write-Host ""
Write-Host "   Login demo :  owner@nusantara.demo"
Write-Host "   Password   :  DemoRental2026"
Write-Host ""
Read-Host "Tekan Enter untuk menutup"
