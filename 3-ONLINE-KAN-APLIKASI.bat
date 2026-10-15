@echo off
title Rental Management System - Cloudflare Online Tunnel
cd /d "%~dp0"

echo ===================================================================
echo     MEMBUAT LINK ONLINE CLOUDFLARE UNTUK RENTAL SYSTEM
echo ===================================================================
echo.
echo 1. Memeriksa apakah aplikasi lokal sedang berjalan...

netstat -ano | findstr ":5173" >nul
if %errorlevel% neq 0 (
    echo Aplikasi belum berjalan. Memulai aplikasi secara otomatis...
    start "Rental Management System - App" cmd /c "call 2-JALANKAN-APLIKASI.bat"
    echo Menunggu server siap (10 detik)...
    timeout /t 10 /nobreak >nul
) else (
    echo Aplikasi lokal sudah aktif di http://localhost:5173!
)

echo.
echo 2. Menghubungkan ke Cloudflare Tunnel (100%% Gratis, Tanpa Kartu Kredit)...
echo ===================================================================
echo Salin link https://...trycloudflare.com yang muncul di bawah ini
echo untuk dibuka dari HP atau dibagikan ke siapapun di mana saja!
echo.
echo JANGAN TUTUP jendela ini selama aplikasi ingin bisa diakses online.
echo ===================================================================
echo.

if exist "cloudflared.exe" (
    cloudflared.exe tunnel --url http://localhost:5173
) else if exist "%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe" (
    "%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe" tunnel --url http://localhost:5173
) else (
    npx --yes untun tunnel 5173
)

pause
