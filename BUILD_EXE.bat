@echo off
setlocal
title KESA - Windows EXE Builder
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

echo Installing dependencies...
call npm install
if errorlevel 1 goto fail

echo Building KESA Windows installer...
call npm run build:win
if errorlevel 1 goto fail

echo.
echo SUCCESS. Open the release folder to find the KESA installer.
pause
exit /b 0

:fail
echo.
echo BUILD FAILED. Copy the error text above and send it for troubleshooting.
pause
exit /b 1
