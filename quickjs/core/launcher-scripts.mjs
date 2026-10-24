/* Dairn launcher 脚本文本的唯一源码位置。
 *
 * 这些文本是 Dairn 源码的一部分，不是需要人工维护的脚本副本：
 *   - 仓库根启动器 `dairn` / `dairn.cmd` 由 `tools/render-launchers.mjs` 从这里生成；
 *   - 目标项目的根启动器由 `dairn init|adopt|upgrade` 写入并纳入 lock 受管资源；
 *   - 分发 ZIP / npm / Wheel 里的 `dairn` / `dairn.cmd` 与仓库根文件字节一致。
 *
 * 脚本只负责解析运行时并转发参数，不解释 Dairn 命令。解析顺序：
 *   1. 显式 DAIRN_RUNTIME（构建/验证时使用）；
 *   2. 启动器同目录 `.dairn/runtime/dairn-embedded.com`（项目 vendored 运行时）；
 *   3. 报错并以退出码 2 结束，不静默安装、不回退到其他版本。
 *
 * 解析结果通过环境变量传给内核：
 *   - DAIRN_RUNTIME_SOURCE：vendored | external（doctor 观察字段）；
 *   - DAIRN_RUNTIME_DIR：运行时所在目录，init/adopt/upgrade 据此复制运行时载荷。
 *
 * 两份脚本文本必须保持 ASCII/最小依赖：POSIX 版只用 /bin/sh 内建；
 * Windows 版不得包含非 ASCII 注释（cmd.exe 代码页会误解析），并使用
 * goto 标签而不是括号块（`%ERRORLEVEL%` 在括号内会被提前展开）。
 */
export const RUNTIME_SOURCE_ENV = 'DAIRN_RUNTIME_SOURCE';
export const RUNTIME_DIR_ENV = 'DAIRN_RUNTIME_DIR';

export const POSIX_LAUNCHER_LINES = [
  '#!/bin/sh',
  '# Dairn launcher (generated from quickjs/core/launcher-scripts.mjs; do not edit).',
  '# Runtime resolution: DAIRN_RUNTIME, then ./.dairn/runtime/dairn-embedded.com.',
  'set -eu',
  '# The APE sh loader needs base system tools (dd/gzip) even when a harness clears PATH.',
  'if [ -z "${PATH:-}" ]; then PATH=/usr/local/bin:/usr/bin:/bin; export PATH; fi',
  'case "$0" in */*) DAIRN_DIR=${0%/*} ;; *) DAIRN_DIR=. ;; esac',
  'DAIRN_HOME=$(CDPATH= cd -- "$DAIRN_DIR" && pwd)',
  'if [ -n "${DAIRN_RUNTIME:-}" ]; then',
  '  case "$DAIRN_RUNTIME" in',
  '    /*) DAIRN_RUNTIME_FILE=$DAIRN_RUNTIME ;;',
  '    *) DAIRN_RUNTIME_FILE=$DAIRN_HOME/$DAIRN_RUNTIME ;;',
  '  esac',
  '  if [ ! -f "$DAIRN_RUNTIME_FILE" ]; then',
  '    echo "dairn: DAIRN_RUNTIME is not a file: $DAIRN_RUNTIME_FILE" >&2',
  '    exit 2',
  '  fi',
  '  DAIRN_RUNTIME_SOURCE=external; export DAIRN_RUNTIME_SOURCE',
  'else',
  '  DAIRN_RUNTIME_FILE=$DAIRN_HOME/.dairn/runtime/dairn-embedded.com',
  '  if [ ! -f "$DAIRN_RUNTIME_FILE" ]; then',
  '    echo "dairn: governance runtime not found (DAIRN_NOT_AVAILABLE)" >&2',
  '    echo "  expected: $DAIRN_HOME/.dairn/runtime/dairn-embedded.com" >&2',
  '    echo "  run this launcher from an extracted release or a project created with dairn init/adopt," >&2',
  '    echo "  or in the Dairn source repository set DAIRN_RUNTIME=<repo>/runtime/dairn-embedded.com" >&2',
  '    exit 2',
  '  fi',
  '  DAIRN_RUNTIME_SOURCE=vendored; export DAIRN_RUNTIME_SOURCE',
  'fi',
  'DAIRN_RUNTIME_DIR=${DAIRN_RUNTIME_FILE%/*}; export DAIRN_RUNTIME_DIR',
  '# The APE sh loader also needs the executable bit; restoring it is harmless.',
  'if [ ! -x "$DAIRN_RUNTIME_FILE" ]; then chmod u+x "$DAIRN_RUNTIME_FILE" 2>/dev/null || true; fi',
  'exec /bin/sh "$DAIRN_RUNTIME_FILE" /zip/quickjs/main.mjs "$@"',
];

export const WINDOWS_LAUNCHER_LINES = [
  '@echo off',
  'rem Dairn launcher (generated from quickjs/core/launcher-scripts.mjs; do not edit).',
  'rem Runtime resolution: DAIRN_RUNTIME, then .dairn\\runtime\\dairn-embedded.com.',
  'setlocal',
  'set "DAIRN_HOME=%~dp0"',
  'if defined DAIRN_RUNTIME goto dairn_external',
  'if exist "%DAIRN_HOME%.dairn\\runtime\\dairn-embedded.com" goto dairn_vendored',
  'echo dairn: governance runtime not found (DAIRN_NOT_AVAILABLE) 1>&2',
  'echo   expected: %DAIRN_HOME%.dairn\\runtime\\dairn-embedded.com 1>&2',
  'echo   run this launcher from an extracted release or a project created with dairn init or adopt, 1>&2',
  'echo   or in the Dairn source repository build the runtime and set DAIRN_RUNTIME 1>&2',
  'exit /b 2',
  ':dairn_external',
  'set "DAIRN_RUNTIME_FILE=%DAIRN_RUNTIME%"',
  'rem Relative DAIRN_RUNTIME resolves against the launcher directory, matching POSIX.',
  'if not "%DAIRN_RUNTIME_FILE:~1,1%"==":" if not "%DAIRN_RUNTIME_FILE:~0,1%"=="\\" set "DAIRN_RUNTIME_FILE=%DAIRN_HOME%%DAIRN_RUNTIME_FILE%"',
  'for %%I in ("%DAIRN_RUNTIME_FILE%") do set "DAIRN_RUNTIME_FILE=%%~fI"',
  'if not exist "%DAIRN_RUNTIME_FILE%" goto dairn_bad_runtime',
  'set "DAIRN_RUNTIME_SOURCE=external"',
  'for %%I in ("%DAIRN_RUNTIME_FILE%") do set "DAIRN_RUNTIME_DIR=%%~dpI"',
  '"%DAIRN_RUNTIME_FILE%" /zip/quickjs/main.mjs %*',
  'exit /b %ERRORLEVEL%',
  ':dairn_bad_runtime',
  'echo dairn: DAIRN_RUNTIME is not a file: %DAIRN_RUNTIME_FILE% 1>&2',
  'exit /b 2',
  ':dairn_vendored',
  'set "DAIRN_RUNTIME_SOURCE=vendored"',
  'set "DAIRN_RUNTIME_DIR=%DAIRN_HOME%.dairn\\runtime"',
  '"%DAIRN_HOME%.dairn\\runtime\\dairn-embedded.com" /zip/quickjs/main.mjs %*',
  'exit /b %ERRORLEVEL%',
];
