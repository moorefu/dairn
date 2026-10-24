@echo off
rem Dairn launcher (generated from quickjs/core/launcher-scripts.mjs; do not edit).
rem Runtime resolution: DAIRN_RUNTIME, then .dairn\runtime\dairn-embedded.com.
setlocal
set "DAIRN_HOME=%~dp0"
if defined DAIRN_RUNTIME goto dairn_external
if exist "%DAIRN_HOME%.dairn\runtime\dairn-embedded.com" goto dairn_vendored
echo dairn: governance runtime not found (DAIRN_NOT_AVAILABLE) 1>&2
echo   expected: %DAIRN_HOME%.dairn\runtime\dairn-embedded.com 1>&2
echo   run this launcher from an extracted release or a project created with dairn init or adopt, 1>&2
echo   or in the Dairn source repository build the runtime and set DAIRN_RUNTIME 1>&2
exit /b 2
:dairn_external
set "DAIRN_RUNTIME_FILE=%DAIRN_RUNTIME%"
rem Relative DAIRN_RUNTIME resolves against the launcher directory, matching POSIX.
if not "%DAIRN_RUNTIME_FILE:~1,1%"==":" if not "%DAIRN_RUNTIME_FILE:~0,1%"=="\" set "DAIRN_RUNTIME_FILE=%DAIRN_HOME%%DAIRN_RUNTIME_FILE%"
for %%I in ("%DAIRN_RUNTIME_FILE%") do set "DAIRN_RUNTIME_FILE=%%~fI"
if not exist "%DAIRN_RUNTIME_FILE%" goto dairn_bad_runtime
set "DAIRN_RUNTIME_SOURCE=external"
for %%I in ("%DAIRN_RUNTIME_FILE%") do set "DAIRN_RUNTIME_DIR=%%~dpI"
"%DAIRN_RUNTIME_FILE%" /zip/quickjs/main.mjs %*
exit /b %ERRORLEVEL%
:dairn_bad_runtime
echo dairn: DAIRN_RUNTIME is not a file: %DAIRN_RUNTIME_FILE% 1>&2
exit /b 2
:dairn_vendored
set "DAIRN_RUNTIME_SOURCE=vendored"
set "DAIRN_RUNTIME_DIR=%DAIRN_HOME%.dairn\runtime"
"%DAIRN_HOME%.dairn\runtime\dairn-embedded.com" /zip/quickjs/main.mjs %*
exit /b %ERRORLEVEL%
