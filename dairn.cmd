@echo off
setlocal
rem Dairn launcher: single entry point for source repo, npm, Wheel and ZIP.
rem
rem Runtime roles (do not mix):
rem   - governance runtime snapshot: .dairn\runtime\ (vendored APE)
rem     is executed directly by this launcher for daily commands; no build required.
rem   - build output: root runtime\ (from python tools/build.py) is only for
rem     builds, packaging and explicitly verifying new source via DAIRN_RUNTIME.
rem   - source: quickjs\ is the source of truth; run build and vendor/upgrade
rem     only when refreshing the governance runtime or preparing a release.
rem
rem Resolution order: DAIRN_RUNTIME -> .dairn\runtime -> packaged runtime\.
rem Use goto labels instead of parentheses blocks: %ERRORLEVEL% inside a block is
rem expanded before the runtime runs, which would swallow real failure codes.
if defined DAIRN_RUNTIME goto dairn_external
if exist "%~dp0.dairn\runtime\dairn-embedded.com" goto dairn_vendored
if not exist "%~dp0runtime\dairn-embedded.com" goto dairn_missing
set "DAIRN_RUNTIME_SOURCE=packaged"
"%~dp0runtime\dairn-embedded.com" /zip/quickjs/main.mjs %*
exit /b %ERRORLEVEL%

:dairn_external
set "DAIRN_RUNTIME_SOURCE=external"
"%DAIRN_RUNTIME%" /zip/quickjs/main.mjs %*
exit /b %ERRORLEVEL%

:dairn_vendored
set "DAIRN_RUNTIME_SOURCE=vendored"
"%~dp0.dairn\runtime\dairn-embedded.com" /zip/quickjs/main.mjs %*
exit /b %ERRORLEVEL%

:dairn_missing
echo Dairn runtime missing: %~dp0.dairn\runtime\dairn-embedded.com and %~dp0runtime\dairn-embedded.com 1>&2
echo Keep .dairn/runtime/ vendored for daily use; build with "python tools/build.py" only when refreshing the governance runtime. 1>&2
exit /b 2
