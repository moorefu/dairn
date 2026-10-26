"""在私有目录构建或读取发行 ZIP，运行子命令并清理候选；保留退出码与诊断。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

from dairn_build_backend import ROOT
from runtime_context import test_runtime, remove_owned_candidate, ChildTracker
from release_config import build_instant, format_instant
from source_workspace import runtime_payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--from-zip', type=Path)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('需要 -- 后的测试命令')
    runs = ROOT / '.build/runs'
    runs.mkdir(parents=True, exist_ok=True)
    if runs.is_symlink() or runs.resolve() != ROOT.resolve() / '.build/runs':
        parser.error('候选目录不得通过链接越界')
    run = Path(tempfile.mkdtemp(prefix=str(os.getpid()) + '-', dir=runs))
    run.chmod(0o700)
    marker = {'pid': os.getpid(), 'created_at': time.time(), 'id': run.name,
              'child_pids': [], 'launch_pending': False}

    def save_owner():
        pending = run / 'owner.next.json'
        pending.write_text(json.dumps(marker), encoding='utf-8')
        pending.replace(run / 'owner.json')

    save_owner()
    output = ROOT / 'validation/runtime-builds' / run.name
    output.mkdir(parents=True)
    summary = {'schema': 'dairn.candidate-build.v1', 'id': run.name,
               'role': 'candidate', 'exit_code': 1, 'cleanup': 'pending'}
    child = None
    build_env={**os.environ,'DAIRN_BUILD_TIME':os.environ.get('DAIRN_BUILD_TIME') or format_instant(build_instant())}
    previous = {}
    tracker=ChildTracker(run.name)
    marker['job_name']=tracker.name
    save_owner()
    interrupted_code=130

    def launch(argv, **options):
        # 先持久化不确定状态，防止 fork 后、PID 落盘前被强制结束时误删活动载荷。
        marker['launch_pending'] = True
        save_owner()
        try:
            process = subprocess.Popen(argv, **options)
        except Exception:
            marker['launch_pending'] = False
            save_owner()
            raise
        tracker.track(process)
        marker['child_pids'].append(process.pid)
        marker['child_pid'] = process.pid
        marker['launch_pending'] = False
        save_owner()
        return process

    def interrupted(signum, frame):
        nonlocal interrupted_code
        interrupted_code=128+signum
        if child is not None and child.poll() is None:
            if os.name == 'posix':
                os.killpg(child.pid, signum)
            else:
                child.send_signal(signal.CTRL_BREAK_EVENT if signum == signal.SIGINT else signal.SIGTERM)
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:pass
        raise KeyboardInterrupt

    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            previous[sig] = signal.signal(sig, interrupted)
        runtime = run / 'runtime'
        if args.from_zip:
            archive = args.from_zip.resolve()
            if archive.is_dir():
                candidates = list(archive.glob("*.zip"))
                if len(candidates) != 1:
                    raise ValueError("制品目录必须包含唯一 ZIP")
                archive = candidates[0]
            binary, integrity = runtime_payload(ROOT, archive)
            runtime.mkdir()
            (runtime / 'dairn-embedded.com').write_bytes(binary)
            (runtime / 'runtime-integrity.json').write_bytes(integrity)
        else:
            # 构建输出单独落盘，失败时也能保留，不把输出内容写进常规观测事件。
            with (output / 'build.log').open('wb') as stream:
                child = launch([sys.executable, '-B', str(ROOT / 'tools/build.py'),
                    '--out', str(run / 'artifacts'), '--runtime-out', str(runtime)],
                    cwd=ROOT,env=build_env, stdout=stream, stderr=subprocess.STDOUT,
                    start_new_session=os.name == 'posix',creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name=='nt' else 0)
                code = child.wait()
            if code:
                summary['exit_code'] = code
                return code
        binary = runtime / 'dairn-embedded.com'
        binary.chmod(0o700)
        env = {**build_env, 'DAIRN_TEST_RUNTIME': str(binary), 'DAIRN_RUNTIME': str(binary),
               'DAIRN_QJS_BIN': str(binary), 'DAIRN_RUNTIME_DIR': str(runtime),
               'DAIRN_RUNTIME_ROLE': 'candidate'}
        original = os.environ.get('DAIRN_TEST_RUNTIME')
        os.environ['DAIRN_TEST_RUNTIME'] = str(binary)
        try:
            test_runtime()
        finally:
            if original is None:
                os.environ.pop('DAIRN_TEST_RUNTIME', None)
            else:
                os.environ['DAIRN_TEST_RUNTIME'] = original
        summary['candidate_sha256'] = hashlib.sha256(binary.read_bytes()).hexdigest()
        # 发行源码夹具不一定携带 .git；诊断缺失不能阻止真实命令或改写其退出码。
        try:
            summary['source_commit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'],
                cwd=ROOT, text=True, stderr=subprocess.DEVNULL, timeout=10).strip() or None
        except (OSError, subprocess.SubprocessError):
            summary['source_commit'] = None
        summary['python'] = sys.version.split()[0]
        # 只向子进程提供覆盖；调用方 Shell 和固定治理 Runtime 始终不变。
        child = launch(command, cwd=ROOT, env=env, start_new_session=os.name == 'posix',creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name=='nt' else 0)
        summary['exit_code'] = child.wait()
        return summary['exit_code']
    except KeyboardInterrupt:
        summary['exit_code'] = interrupted_code
        return interrupted_code
    except Exception as error:
        summary['error_type'] = type(error).__name__
        print('候选构建失败：' + str(error), file=sys.stderr)
        return summary['exit_code']
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        # 只清理本次独占目录；不使用 TTL 删除其他进程的活跃候选。
        if child is not None and child.poll() is None:
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:pass
        try:
            if run.is_symlink() or json.loads((run/'owner.json').read_text())!=marker:
                raise RuntimeError('候选所有权标记改变')
            if marker['launch_pending']:
                raise RuntimeError('子进程启动状态未知')
            deadline=time.monotonic()+1
            while tracker.children_alive(child) is True and time.monotonic()<deadline:
                time.sleep(0.05)
            if tracker.children_alive(child) is not False:
                raise RuntimeError('仍有子进程或进程状态未知')
            remove_owned_candidate(run,marker)
            summary['cleanup'] = 'completed'
        except (OSError, RuntimeError, ValueError):
            summary['cleanup'] = 'cleanup-deferred'
        tracker.close()
        (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print('候选诊断：' + str(output / 'summary.json'), file=sys.stderr)


if __name__ == '__main__':
    sys.exit(main())
