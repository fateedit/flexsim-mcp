@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   FlexSim WebServer 控制台 启动中 ...
echo   若提示找不到 electron，请先执行：npm install
echo ========================================
npm run dev
if errorlevel 1 (
  echo.
  echo [启动失败] 请检查上方错误信息，或先在本目录运行 npm install
  pause
)
