@echo off
rem Start the StepFun usage monitor proxy (default port 8787)
cd /d "%~dp0"
node proxy.mjs
pause
