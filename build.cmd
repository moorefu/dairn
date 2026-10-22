@echo off
setlocal
"%~dp0dairn-embedded.com" "%~dp0tools\build-zip.mjs" --root "%~dp0." %*
exit /b %ERRORLEVEL%
