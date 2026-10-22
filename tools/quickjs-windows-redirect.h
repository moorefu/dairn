/* 固定适配 Cosmopolitan 4.0.2；仅在 fork 子进程中准备重定向句柄。 */
#ifdef __COSMOPOLITAN__
#include <libc/calls/internal.h>
#include <libc/nt/files.h>
#include <libc/nt/process.h>
#include <libc/nt/enum/accessmask.h>
#include <libc/nt/enum/filesharemode.h>
#include <libc/nt/enum/filetype.h>

static void dairn_sync_redirects(const int std_fds[3])
{
    int i, j;
    if (!IsWindows())
        return;
    for (i = 0; i < 3; i++) {
        int fd = std_fds[i];
        int mode;
        uint32_t access;
        int64_t handle, offset;
        long high;
        if (fd == i)
            continue;
        for (j = 0; j < i; j++)
            if (std_fds[j] == fd && std_fds[j] != j)
                break;
        if (j < i)
            continue;
        if (!__isfdopen(fd))
            ExitProcess(127);
        if (GetFileType(g_fds.p[fd].handle) != kNtFileTypeDisk)
            continue;
        /* Cosmo open 默认创建 OVERLAPPED 文件，Git/MSVCRT 的同步写入不能使用它。
           同一来源只重开一次，再由 dup2 共享同步文件位置，避免 stdout/stderr 覆盖。 */
        mode = g_fds.p[fd].flags & O_ACCMODE;
        access = mode == O_RDONLY ? kNtGenericRead :
                 mode == O_WRONLY ? kNtGenericWrite : kNtGenericRead | kNtGenericWrite;
        offset = lseek(fd, 0, SEEK_CUR);
        if (offset < 0)
            ExitProcess(127);
        handle = ReOpenFile(g_fds.p[fd].handle, access,
                            kNtFileShareRead | kNtFileShareWrite | kNtFileShareDelete, 0);
        if (handle == -1)
            ExitProcess(127);
        high = (int32_t)(offset >> 32);
        /* SetFilePointer 的全 1 返回值也可能是合法位置，结合 GetLastError 判断。 */
        SetLastError(0);
        if (SetFilePointer(handle, (int32_t)offset, &high, 0) == UINT32_MAX && GetLastError())
            ExitProcess(127);
        CloseHandle(g_fds.p[fd].handle);
        g_fds.p[fd].handle = handle;
    }
}
#endif
