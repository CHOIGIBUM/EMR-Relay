@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\test-windows.ps1"
set "testExitCode=%ERRORLEVEL%"
pause
exit /b %testExitCode%
