@echo off
setlocal
"%~dp0runtime\dairn-embedded.com" /zip/quickjs/main.mjs %*
exit /b %ERRORLEVEL%
