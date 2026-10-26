"""测试候选的显式路径协议；不从根 runtime/ 隐式回退。"""
import hashlib
import json
import os
from pathlib import Path


def test_runtime():
    value = os.environ.get('DAIRN_TEST_RUNTIME')
    if not value:
        raise RuntimeError('缺少候选上下文；请用 python tools/with-built-runtime.py -- <测试命令>')
    path = Path(value)
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise RuntimeError('DAIRN_TEST_RUNTIME 必须指向绝对路径的普通候选文件')
    metadata = path.with_name('runtime-integrity.json')
    if metadata.is_symlink():
        raise RuntimeError('候选完整性清单不得为符号链接')
    document = json.loads(metadata.read_text(encoding='utf-8'))
    if document.get('binary') != path.name or document.get('sha256') != hashlib.sha256(path.read_bytes()).hexdigest():
        raise RuntimeError('候选运行时摘要不匹配')
    return path


def remove_owned_candidate(run, owner):
    """保留所有权标记直到其余内容删除成功，Windows 占用失败后仍能安全回收。"""
    import shutil
    marker = run / 'owner.json'
    if run.is_symlink() or json.loads(marker.read_text(encoding='utf-8')) != owner:
        raise RuntimeError('候选所有权标记改变')
    for child in run.iterdir():
        if child == marker:
            continue
        if child.is_symlink() or child.is_file():
            child.unlink()
        elif child.is_dir():
            shutil.rmtree(child)
        else:
            raise RuntimeError('候选目录含未知文件类型')
    marker.unlink()
    run.rmdir()


class ChildTracker:
    """POSIX 进程组或 Windows Job 追踪；状态未知时保留候选。"""
    def __init__(self, name):
        self.job = None
        self.name = None
        self.processes = []
        if os.name == 'nt':
            import ctypes
            from ctypes import wintypes
            self.ctypes = ctypes
            self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
            self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
            self.kernel.GetCurrentProcess.restype = wintypes.HANDLE
            self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
            self.kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
            self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            candidate = self.kernel.CreateJobObjectW(None, 'Local\\DairnCandidate-' + name)
            if candidate and self.kernel.AssignProcessToJobObject(candidate, self.kernel.GetCurrentProcess()):
                self.job, self.name = candidate, 'Local\\DairnCandidate-' + name
            elif candidate:
                self.kernel.CloseHandle(candidate)

    def track(self, process):
        self.processes.append(process)

    def children_alive(self, process=None):
        if os.name == 'posix':
            processes = self.processes + ([process] if process is not None and process not in self.processes else [])
            unknown = False
            for child in processes:
                try:
                    os.killpg(child.pid, 0)
                    return True
                except ProcessLookupError:
                    pass
                except OSError:
                    unknown = True
            return None if unknown else False
        if os.name == 'nt' and self.job:
            import ctypes
            class Accounting(ctypes.Structure):
                _fields_ = [('times', ctypes.c_int64 * 4), ('faults', ctypes.c_uint32),
                            ('total', ctypes.c_uint32), ('active', ctypes.c_uint32), ('terminated', ctypes.c_uint32)]
            info = Accounting()
            if self.kernel.QueryInformationJobObject(self.job, 1, ctypes.byref(info), ctypes.sizeof(info), None):
                return info.active > 1  # 包装器自身仍在 Job 内。
        return None

    def close(self):
        if self.job:
            self.kernel.CloseHandle(self.job)
            self.job = None
