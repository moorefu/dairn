/* 项目内 Dairn launcher 脚本文本的唯一源码位置。
 *
 * 这些文本是 Dairn 源码的一部分：project.mjs 在 init/upgrade 时把它们写入
 * `.dairn/bin/` 并纳入 lock 受管资源；`.dairn/bin/` 里的是可重新生成的副本，
 * 不是第二份需要人工维护的启动器实现。
 *
 * 脚本只负责解析运行时并转发参数，不解释 Dairn 命令：
 *   DAIRN_BIN -> 项目 vendored 运行时 -> PATH 中的 dairn -> exit 127。
 * 选择结果通过 DAIRN_RUNTIME_SOURCE 传给运行时，doctor 据此报告实际来源。
 *
 * 运行时角色约定（与仓库根启动器一致）：
 *   - 项目 vendored 运行时（`.dairn/runtime/`）是治理运行时的实际执行者；
 *   - 仓库根 `runtime/` 只在构建/打包/验证流程中使用，不参与日常命令解析。
 */
export const RUNTIME_SOURCE_ENV = 'DAIRN_RUNTIME_SOURCE';

export const POSIX_LAUNCHER_LINES = [
  '#!/bin/sh',
  '# Dairn project launcher (managed by dairn; do not edit).',
  'set -eu',
  '# The APE sh loader needs base system tools (dd/gzip) even when a harness clears PATH.',
  'if [ -z "${PATH:-}" ]; then PATH=/usr/local/bin:/usr/bin:/bin; export PATH; fi',
  '# Resolve the project root with shell builtins only: the launcher must also work',
  '# with a minimal PATH so it can print the clear "dairn not found" error.',
  'case "$0" in */*) LAUNCHER_DIR=${0%/*} ;; *) LAUNCHER_DIR=. ;; esac',
  'ROOT=$(CDPATH= cd -- "$LAUNCHER_DIR/../.." && pwd)',
  'if [ -n "${DAIRN_BIN:-}" ]; then DAIRN_RUNTIME_SOURCE=external; export DAIRN_RUNTIME_SOURCE; exec "$DAIRN_BIN" "$@"; fi',
  'if [ -f "$ROOT/.dairn/runtime/dairn-embedded.com" ]; then',
  '  DAIRN_RUNTIME_SOURCE=vendored; export DAIRN_RUNTIME_SOURCE',
  '  exec /bin/sh "$ROOT/.dairn/runtime/dairn-embedded.com" /zip/quickjs/main.mjs "$@"',
  'fi',
  'if command -v dairn >/dev/null 2>&1; then DAIRN_RUNTIME_SOURCE=path; export DAIRN_RUNTIME_SOURCE; exec dairn "$@"; fi',
  'echo "dairn not found (DAIRN_NOT_AVAILABLE): vendor the runtime into .dairn/runtime/ or set DAIRN_BIN" >&2',
  'exit 127',
];

export const WINDOWS_LAUNCHER_LINES = [
  '@echo off',
  'setlocal',
  'set "ROOT=%~dp0..\\.."',
  'if defined DAIRN_BIN goto dairn_external',
  'if exist "%ROOT%\\.dairn\\runtime\\dairn-embedded.com" goto dairn_vendored',
  'where dairn >nul 2>nul',
  'if errorlevel 1 goto dairn_missing',
  'set "DAIRN_RUNTIME_SOURCE=path"',
  'dairn %*',
  'exit /b %ERRORLEVEL%',
  ':dairn_external',
  'set "DAIRN_RUNTIME_SOURCE=external"',
  '"%DAIRN_BIN%" %*',
  'exit /b %ERRORLEVEL%',
  ':dairn_vendored',
  'set "DAIRN_RUNTIME_SOURCE=vendored"',
  '"%ROOT%\\.dairn\\runtime\\dairn-embedded.com" /zip/quickjs/main.mjs %*',
  'exit /b %ERRORLEVEL%',
  ':dairn_missing',
  'echo dairn not found (DAIRN_NOT_AVAILABLE): vendor the runtime into .dairn\\runtime\\ or set DAIRN_BIN 1>&2',
  'exit /b 127',
];
