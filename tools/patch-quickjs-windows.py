"""应用 windows-cosmo-v1 补丁；所有上下文必须精确匹配，否则拒绝构建。"""
from pathlib import Path
import sys

source = Path(sys.argv[1]) / 'quickjs-libc.c'
text = source.read_text(encoding='utf-8')
changes = [
    ('#include <stdlib.h>', '#include <stdlib.h>\n#ifdef __COSMOPOLITAN__\n#include <cosmo.h>\n#include <libc/nt/runtime.h>\n#endif'),
    ('    exit(status);',
     '    /* 原生 Windows 调用者需要未经过 POSIX 位移的退出码。 */\n'
     '#ifdef __COSMOPOLITAN__\n'
     '    if (IsWindows()) {\n'
     '        fflush(NULL);\n'
     '        ExitProcess((uint32_t)status);\n'
     '    }\n'
     '#endif\n'
     '    exit(status);'),
    ('int fd_max = min_int(sysconf(_SC_OPEN_MAX), 1024);',
     'int fd_max = min_int(sysconf(_SC_OPEN_MAX), 1024);\n'
     '            /* Windows 的 sysconf 可返回 -1，不能与无符号 i 比较。 */\n'
     '            if (fd_max < 0)\n'
     '                fd_max = 1024;'),
    ('/* exec(args[, options]) -> exitcode */',
     Path(__file__).with_name('quickjs-windows-redirect.h').read_text(encoding='utf-8') +
     '\n/* exec(args[, options]) -> exitcode */'),
    ('        /* remap the stdin/stdout/stderr handles if necessary */',
     '#ifdef __COSMOPOLITAN__\n'
     '        dairn_sync_redirects(std_fds);\n'
     '#endif\n'
     '        /* remap the stdin/stdout/stderr handles if necessary */'),
    ('    return JS_SetModuleExportList(ctx, m, js_os_funcs,\n'
     '                                  countof(js_os_funcs));',
     '    int ret = JS_SetModuleExportList(ctx, m, js_os_funcs,\n'
     '                                     countof(js_os_funcs));\n'
     '#ifdef __COSMOPOLITAN__\n'
     '    if (ret == 0)\n'
     '        ret = JS_SetModuleExport(ctx, m, "platform",\n'
     '            JS_NewString(ctx, IsWindows() ? "win32" : IsXnu() ? "darwin" : "linux"));\n'
     '#endif\n'
     '    return ret;'),
]
for old, new in changes:
    if text.count(old) != 1:
        raise SystemExit('源码与 windows-cosmo-v1 补丁上下文不匹配或已打补丁，停止构建')
    text = text.replace(old, new)
source.write_text(text, encoding='utf-8', newline='\n')
