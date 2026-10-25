/* Dairn launcher 的环境变量契约。
 *
 * 启动器脚本文本的源码位置是 quickjs/assets/templates/project/launcher/：
 *   - 仓库根启动器 `dairn` / `dairn.cmd` 由 `tools/render-launchers.mjs` 从模板装配；
 *   - 目标项目的根启动器由 `dairn init|adopt|upgrade` 写入并纳入 lock 受管资源；
 *   - 分发 ZIP / npm / Wheel 里的 `dairn` / `dairn.cmd` 与仓库根文件字节一致。
 *
 * 脚本只负责解析运行时并转发参数，不解释 Dairn 命令。解析顺序：
 *   1. 显式 DAIRN_RUNTIME（构建/验证时使用）；
 *   2. 启动器同目录 `.dairn/runtime/dairn-embedded.com`（项目 vendored 运行时）；
 *   3. 报错并以退出码 2 结束，不静默安装、不回退到其他版本。
 *
 * 解析结果通过环境变量传给内核：
 *   - DAIRN_RUNTIME_SOURCE：vendored | external（启动器解析）或 packaged（安装包包装层）；
 *   - DAIRN_RUNTIME_DIR：运行时所在目录，init/adopt/upgrade 据此复制运行时载荷。
 *
 * 两份脚本文本必须保持 ASCII/最小依赖：POSIX 版使用 /bin/sh 与 mktemp/cp/chmod/rm/rmdir 基础工具；
 * Windows 版不得包含非 ASCII 注释（cmd.exe 代码页会误解析），并使用
 * goto 标签而不是括号块（`%ERRORLEVEL%` 在括号内会被提前展开）。
 */
export const RUNTIME_SOURCE_ENV = 'DAIRN_RUNTIME_SOURCE';
export const RUNTIME_DIR_ENV = 'DAIRN_RUNTIME_DIR';
