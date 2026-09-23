@echo off
set "SETUP_SCRIPT=%~dp0scripts\configure-mobile.ps1"

where powershell.exe >nul 2>nul
if not errorlevel 1 (
  if /I "%~1"=="-SelfTest" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SETUP_SCRIPT%" -SelfTest
    exit /b %errorlevel%
  )
  start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%SETUP_SCRIPT%"
  exit /b 0
)

where pwsh.exe >nul 2>nul
if not errorlevel 1 (
  if /I "%~1"=="-SelfTest" (
    pwsh.exe -NoProfile -File "%SETUP_SCRIPT%" -SelfTest
    exit /b %errorlevel%
  )
  start "" pwsh.exe -NoProfile -WindowStyle Hidden -File "%SETUP_SCRIPT%"
  exit /b 0
)

echo Windows PowerShell or PowerShell 7 is required.
pause
exit /b 1
