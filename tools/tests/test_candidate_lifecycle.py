"""候选构建的真实生命周期：失败码、清理、并发与固定 Runtime 隔离。"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from runtime_context import test_runtime
from source_workspace import zip_paths


class CandidateLifecycle(unittest.TestCase):
    def fixture_archive(self, temp):
        archive = temp / 'dairn-0.1.0-nightly.20261025000000.zip'
        prefix = archive.stem + '/'
        payload = '生命周期夹具，不执行运行时'.encode()
        integrity = json.dumps({'binary': 'dairn-embedded.com',
                                'sha256': hashlib.sha256(payload).hexdigest()}).encode()
        with zipfile.ZipFile(archive, 'w') as zipped:
            for name in sorted(zip_paths(ROOT)):
                data = (payload if name.endswith('/dairn-embedded.com') else integrity
                        if name.endswith('/runtime-integrity.json') else (ROOT / name).read_bytes())
                zipped.writestr(prefix + name, data)
        return archive

    def snapshot(self):
        files = [ROOT / '.dairn/lock.json', *sorted((ROOT / '.dairn/runtime').glob('*')),
                 *sorted((ROOT / 'runtime').glob('*'))]
        return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()}

    def invoke(self, code):
        return subprocess.run([sys.executable, '-B', str(ROOT / 'tools/with-built-runtime.py'),
            '--', sys.executable, '-c', code], cwd=ROOT, capture_output=True, text=True, timeout=180)

    def test_failure_preserves_exit_and_cleans_only_its_candidate(self):
        before = self.snapshot()
        result = self.invoke("import os,sys; print(os.environ['DAIRN_TEST_RUNTIME']); sys.exit(37)")
        self.assertEqual(result.returncode, 37, result.stdout + result.stderr)
        binary = Path(result.stdout.strip().splitlines()[-1])
        self.assertFalse(binary.parent.parent.exists())
        report = ROOT / 'validation/runtime-builds' / binary.parent.parent.name / 'summary.json'
        data = json.loads(report.read_text())
        self.assertEqual(data['exit_code'], 37)
        self.assertEqual(data['cleanup'], 'completed')
        self.assertEqual(before, self.snapshot())

    def test_parallel_builds_have_distinct_candidates_and_same_fixed_build(self):
        with patch.dict(os.environ, {'DAIRN_BUILD_TIME': '2026-10-25T20:00:00+08:00'}):
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(self.invoke, [
                    "import os; print(os.environ['DAIRN_TEST_RUNTIME'])"] * 2))
        paths, hashes = [], []
        for result in results:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            path = Path(result.stdout.strip().splitlines()[-1])
            self.assertFalse(path.parent.parent.exists())
            paths.append(path)
            report = ROOT / 'validation/runtime-builds' / path.parent.parent.name / 'summary.json'
            hashes.append(json.loads(report.read_text())['candidate_sha256'])
        self.assertNotEqual(paths[0], paths[1])
        self.assertEqual(hashes[0], hashes[1])

    def test_source_npm_pack_cannot_modify_pin(self):
        before = self.snapshot()
        result = subprocess.run(['node', 'tools/build.cjs', '--stage-only'], cwd=ROOT,
                                capture_output=True, text=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('npm run build', result.stderr)
        self.assertEqual(before, self.snapshot())

    def test_explicit_candidate_rejects_tampered_integrity(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'dairn-embedded.com'
            binary.write_bytes(b'candidate')
            binary.with_name('runtime-integrity.json').write_text(json.dumps({
                'binary': binary.name, 'sha256': '0' * 64}))
            with patch.dict(os.environ, {'DAIRN_TEST_RUNTIME': str(binary)}):
                with self.assertRaisesRegex(RuntimeError, '摘要不匹配'):
                    test_runtime()

    @unittest.skipUnless(os.name == 'posix', '强制退出与进程组回收使用 POSIX 信号')
    def test_killed_wrapper_cannot_make_active_child_eligible_for_cleanup(self):
        with tempfile.TemporaryDirectory(prefix='dairn-candidate-owner-') as directory:
            temp = Path(directory)
            archive = self.fixture_archive(temp)
            ready = temp / 'ready.json'
            command = ('import json,os,pathlib,time; pathlib.Path(' + repr(str(ready)) +
                       ').write_text(json.dumps({"pid":os.getpid(),"runtime":os.environ["DAIRN_TEST_RUNTIME"]})); time.sleep(120)')
            process = subprocess.Popen([sys.executable, '-B', str(ROOT / 'tools/with-built-runtime.py'),
                '--from-zip', str(archive), '--', sys.executable, '-c', command], cwd=ROOT,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            child, run = None, None
            try:
                deadline = time.monotonic() + 15
                while not ready.exists() and time.monotonic() < deadline and process.poll() is None:
                    time.sleep(0.05)
                self.assertTrue(ready.exists(), '测试子进程未启动')
                info = json.loads(ready.read_text())
                child, run = info['pid'], Path(info['runtime']).parent.parent
                process.kill()
                process.wait(timeout=5)
                marker = run / 'owner.json'
                owner = json.loads(marker.read_text())
                owner['created_at'] = time.time() - 7200
                marker.write_text(json.dumps(owner))
                result = subprocess.run([sys.executable, '-B', str(ROOT / 'tools/cleanup-candidates.py'),
                    run.name, '--apply'], cwd=ROOT, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
                self.assertTrue(run.exists(), '活动子进程使用的候选被删除')
                os.kill(child, 0)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
                if child is not None:
                    try:
                        os.killpg(child, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                if run is not None:
                    shutil.rmtree(run, ignore_errors=True)

    def test_missing_git_diagnostic_preserves_the_test_exit_code(self):
        with tempfile.TemporaryDirectory(prefix='dairn-candidate-no-git-') as directory:
            archive = self.fixture_archive(Path(directory))
            driver = '''import importlib.util,subprocess,sys
sys.path.insert(0,sys.argv[1]+'/tools')
spec=importlib.util.spec_from_file_location('wrapper',sys.argv[1]+'/tools/with-built-runtime.py')
wrapper=importlib.util.module_from_spec(spec);spec.loader.exec_module(wrapper)
def unavailable(*args,**kwargs): raise subprocess.CalledProcessError(128,args[0])
wrapper.subprocess.check_output=unavailable
sys.argv=['wrapper','--from-zip',sys.argv[2],'--',sys.executable,'-c',"import os,sys; print(os.environ['DAIRN_TEST_RUNTIME']); sys.exit(37)"]
sys.exit(wrapper.main())
'''
            result = subprocess.run([sys.executable, '-B', '-c', driver, str(ROOT), str(archive)],
                cwd=ROOT, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 37, result.stdout + result.stderr)
            binary = Path(result.stdout.strip().splitlines()[-1])
            report = ROOT / 'validation/runtime-builds' / binary.parent.parent.name / 'summary.json'
            summary = json.loads(report.read_text())
            self.assertIsNone(summary['source_commit'])
            self.assertEqual(summary['exit_code'], 37)
            self.assertEqual(summary['cleanup'], 'completed')

    def test_unknown_launch_or_child_liveness_cannot_be_cleaned(self):
        spec = importlib.util.spec_from_file_location('candidate_cleanup', ROOT / 'tools/cleanup-candidates.py')
        cleanup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cleanup)
        with tempfile.TemporaryDirectory(prefix='dairn-candidate-unknown-') as directory:
            cleanup.ROOT = Path(directory)
            run = cleanup.ROOT / '.build/runs/123-unknown'
            run.mkdir(parents=True)
            for pending in (True, False):
                with self.subTest(launch_pending=pending):
                    owner = {'id': run.name, 'pid': 123, 'created_at': time.time() - 7200,
                             'launch_pending': pending, 'child_pids': [456]}
                    (run / 'owner.json').write_text(json.dumps(owner))
                    with patch.object(cleanup, 'alive', side_effect=[False, None]), \
                            patch.object(sys, 'argv', ['cleanup', run.name, '--apply']), \
                            redirect_stdout(io.StringIO()):
                        self.assertEqual(cleanup.main(), 3)
                    self.assertTrue(run.exists())

    @unittest.skipUnless(os.name == 'posix', '目录链接边界使用 POSIX 符号链接')
    def test_cleanup_refuses_symlinked_candidate_parent(self):
        spec = importlib.util.spec_from_file_location('candidate_cleanup_link', ROOT / 'tools/cleanup-candidates.py')
        cleanup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cleanup)
        with tempfile.TemporaryDirectory(prefix='dairn-cleanup-boundary-') as directory:
            base = Path(directory)
            checkout, outside = base / 'checkout', base / 'outside'
            checkout.mkdir()
            run = outside / 'runs/123-outside'
            run.mkdir(parents=True)
            checkout.joinpath('.build').symlink_to(outside, target_is_directory=True)
            owner = {'id': run.name, 'pid': 123, 'created_at': time.time() - 7200,
                     'launch_pending': False, 'child_pids': []}
            (run / 'owner.json').write_text(json.dumps(owner))
            cleanup.ROOT = checkout
            with patch.object(cleanup, 'alive', return_value=False), \
                    patch.object(sys, 'argv', ['cleanup', run.name, '--apply']), \
                    redirect_stdout(io.StringIO()):
                self.assertEqual(cleanup.main(), 3)
            self.assertTrue(run.exists(), '越界的候选目录被删除')
