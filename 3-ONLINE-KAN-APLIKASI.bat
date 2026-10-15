@echo off
title Rental Management System - Cloudflare Online Tunnel
cd /d "%~dp0"

echo ===================================================================
echo     MEMBUAT LINK ONLINE CLOUDFLARE UNTUK RENTAL SYSTEM
echo ===================================================================
echo.
echo Menghubungkan ke Cloudflare Tunnel (100%% Gratis, Tanpa Kartu Kredit)...
echo.
echo ===================================================================
echo Link publik https://...trycloudflare.com akan muncul di bawah ini.
echo Salin link tersebut dan buka di browser HP atau bagikan ke orang lain.
echo.
echo JANGAN TUTUP jendela ini selama aplikasi ingin bisa diakses online.
echo ===================================================================
echo.

if not exist "%~dp0cloudflared.exe" (
    echo File cloudflared.exe tidak ditemukan di folder ini!
    pause
    exit /b 1
)

"%~dp0cloudflared.exe" tunnel --url http://localhost:5173

echo.
echo Cloudflare Tunnel terhenti.
pause
