@echo off
rem Double-click to open the Portfolio Analyzer admin console.
cd /d "%~dp0.."
if not exist "backend\.venv\Scripts\python.exe" (
  echo backend\.venv not found. Follow PACKAGING.md Part A first.
  pause
  exit /b 1
)
"backend\.venv\Scripts\python.exe" admin\run.py %*
pause
