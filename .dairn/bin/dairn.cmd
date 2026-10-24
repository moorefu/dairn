@echo off
setlocal
set "ROOT=%~dp0..\.."
if defined DAIRN_BIN goto dairn_external
if exist "%ROOT%\.dairn\runtime\dairn-embedded.com" goto dairn_vendored
where dairn >nul 2>nul
if errorlevel 1 goto dairn_missing
set "DAIRN_RUNTIME_SOURCE=path"
dairn %*
exit /b %ERRORLEVEL%
:dairn_external
set "DAIRN_RUNTIME_SOURCE=external"
"%DAIRN_BIN%" %*
exit /b %ERRORLEVEL%
:dairn_vendored
set "DAIRN_RUNTIME_SOURCE=vendored"
"%ROOT%\.dairn\runtime\dairn-embedded.com" /zip/quickjs/main.mjs %*
exit /b %ERRORLEVEL%
:dairn_missing
echo dairn not found (DAIRN_NOT_AVAILABLE): vendor the runtime into .dairn\runtime\ or set DAIRN_BIN 1>&2
exit /b 127
