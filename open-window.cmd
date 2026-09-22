@echo off
rem StepFun 用量监控「小窗」：用 Edge/Chrome 应用模式打开无地址栏的独立小窗（约 620x700）
rem 前提：本地代理已运行（start.cmd 或 npx -y github:Neriah-Ado/stepfun-usage-monitor）
setlocal
set "PORT=%PORT%"
if "%PORT%"=="" set "PORT=8787"
set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if "%BROWSER%"=="" (
  echo 未找到 Edge 或 Chrome，请手动在浏览器打开: http://127.0.0.1:%PORT%/^?layout=window
  pause
  exit /b 1
)
start "" "%BROWSER%" --app="http://127.0.0.1:%PORT%/?layout=window" --window-size=620,700
endlocal
