@echo off
setlocal
if not exist "%~dp0runtime\dairn-embedded.com" (
  echo Dairn runtime missing: %~dp0runtime\dairn-embedded.com 1>&2
  echo Run "python tools/build.py" in a source checkout, or reinstall the package. 1>&2
  exit /b 2
)
"%~dp0runtime\dairn-embedded.com" /zip/quickjs/main.mjs %*
exit /b %ERRORLEVEL%
