@echo off
where pwsh.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell 7 is required. Install it, then run this file again.
  pause
  exit /b 1
)
start "" pwsh.exe -NoProfile -WindowStyle Hidden -File "%~dp0scripts\configure-mobile.ps1"
