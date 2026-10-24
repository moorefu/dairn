@echo off
setlocal
set "ROOT=%~dp0..\.."
if defined DAIRN_BIN (
  "%DAIRN_BIN%" %*
  exit /b %ERRORLEVEL%
)
if exist "%ROOT%\.dairn\runtime\dairn-embedded.com" (
  "%ROOT%\.dairn\runtime\dairn-embedded.com" /zip/quickjs/main.mjs %*
  exit /b %ERRORLEVEL%
)
where dairn >nul 2>nul
if not errorlevel 1 (
  dairn %*
  exit /b %ERRORLEVEL%
)
echo dairn not found (DAIRN_NOT_AVAILABLE): vendor the runtime into .dairn\runtime\ or set DAIRN_BIN 1>&2
exit /b 127
