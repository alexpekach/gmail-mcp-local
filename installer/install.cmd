@echo off
setlocal enableextensions
title gmail-mcp-local installer
set "SRC=%~dp0app"
set "DEST=%USERPROFILE%\.gmail-mcp-local\app"

echo ============================================
echo   gmail-mcp-local  -  installer (Windows)
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found.
  echo Install the LTS from https://nodejs.org , reopen this window, and run install.cmd again.
  echo.
  pause
  exit /b 1
)

echo Installing to "%DEST%" ...
if not exist "%DEST%" mkdir "%DEST%"
xcopy /E /I /Y /Q "%SRC%\*" "%DEST%\" >nul

pushd "%DEST%"
echo Installing dependencies (keychain helper) ...
call npm install --omit=dev --no-audit --no-fund
echo Wiring into your MCP client (Claude Desktop / Cursor) ...
call node "scripts\install-into-client.js"
popd

echo.
echo Done!
echo   1) Fully quit and reopen Claude Desktop (or Cursor).
echo   2) In the chat:  connect_account({ ref: "work" })
echo.
echo Your email and login token stay on THIS computer. Nothing is sent to any server.
echo.
pause
