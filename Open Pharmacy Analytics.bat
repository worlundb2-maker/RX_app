@echo off
setlocal enableextensions
cd /d "%~dp0"

set "NODE_DIR="
if exist "%CD%\node-v24.14.0-win-x64\node.exe" set "NODE_DIR=%CD%\node-v24.14.0-win-x64"
if not defined NODE_DIR if exist "%CD%\node-runtime\node.exe" set "NODE_DIR=%CD%\node-runtime"
if not defined NODE_DIR (
  for /d %%D in ("%CD%\node-v*-win-x64") do (
    if exist "%%~fD\node.exe" (
      set "NODE_DIR=%%~fD"
      goto :node_found
    )
  )
)

:node_found
if not defined NODE_DIR (
  echo.
  echo Node runtime folder was not found beside this launcher.
  echo Expected a folder like node-v24.14.0-win-x64 with node.exe inside.
  pause
  exit /b 1
)

set "PATH=%NODE_DIR%;%PATH%"
set "NODE_ENV=production"

if not exist "%CD%\node_modules\tsx\dist\cli.mjs" (
  echo.
  echo Missing node_modules\tsx\dist\cli.mjs in this package.
  pause
  exit /b 1
)

if not exist "%CD%\server\index.ts" (
  echo.
  echo Missing server\index.ts in this package.
  pause
  exit /b 1
)

echo Starting Pharmacy Analytics...
start "" "http://127.0.0.1:5000"
"%NODE_DIR%\node.exe" "%CD%\node_modules\tsx\dist\cli.mjs" "%CD%\server\index.ts" --production
