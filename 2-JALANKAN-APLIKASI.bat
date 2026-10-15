@echo off
title Rental Management System
cd /d "%~dp0"
if not exist "node_modules" (
  echo Aplikasi belum di-setup. Jalankan dulu 1-SETUP.bat
  pause
  exit /b 1
)
if not exist ".env" (
  echo File .env belum ada. Jalankan dulu 1-SETUP.bat
  pause
  exit /b 1
)
echo =============================================================
echo    RENTAL MANAGEMENT SYSTEM sedang berjalan
echo    Browser akan terbuka otomatis: http://localhost:5173
echo.
echo    JANGAN TUTUP jendela ini selama aplikasi dipakai.
echo    Untuk mematikan aplikasi: tutup jendela ini.
echo =============================================================
start "" cmd /c "timeout /t 10 /nobreak >nul & start http://localhost:5173"
call npm run dev
pause
