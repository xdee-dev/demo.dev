@echo off
set "PATH=%LOCALAPPDATA%\Programs\Git\cmd;%LOCALAPPDATA%\Programs\Git\ucrt64\bin;%PATH%"
echo ========================================================
echo Mendorong (Push) kode Rental Management System ke GitHub
echo ========================================================
echo.
git push -u origin main
echo.
pause
