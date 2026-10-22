@echo off
setlocal
"%~dp0dairn-embedded.com" /zip/quickjs/main.mjs %*
exit /b %ERRORLEVEL%
