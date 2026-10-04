@echo off
cd /d "%~dp0"
echo =============================================
echo   RELAX QC CONTROL CENTER - BACKEND
 echo =============================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  echo Install Node.js LTS, restart CMD, then run this file again.
  pause
  exit /b 1
)
node --version
npm --version
if not exist node_modules\express (
  echo.
  echo Installing required packages...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Please copy the error above.
    pause
    exit /b 1
  )
)
echo.
echo Starting Relax QC server...
echo Open http://localhost:3000 on this PC.
echo Keep this window open while using the Android app.
echo.
call npm start
pause
