@echo off
set BIN=C:\cbm\codebase-memory-mcp.exe
if not exist "%BIN%" (
  echo Binary not found: %BIN%
  exit /b 1
)
echo Starting CBM UI on http://127.0.0.1:9749 ...
start "CBM-UI" "%BIN%" --ui=true --port=9749
timeout /t 2 >nul
echo Checking...
netstat -ano | findstr :9749
