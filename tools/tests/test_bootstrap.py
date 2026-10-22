"""离线验证上游解释器缓存、摘要门禁和失败清理；不执行测试二进制。"""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dairn 引导 ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'tools').mkdir()
        self.cache = self.root / 'cache'
        self.cache.mkdir()
        script = 'bootstrap.ps1' if os.name == 'nt' else 'bootstrap.sh'
        shutil.copyfile(ROOT / 'tools' / script, self.root / 'tools' / script)
        self.command = (['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                         str(self.root / 'tools' / script), '-FetchOnly'] if os.name == 'nt'
                        else ['/bin/sh', str(self.root / 'tools' / script), '--fetch-only'])
        self.binary = '用于缓存校验的测试数据'.encode('utf-8')
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as zipped:
            zipped.writestr('qjs', self.binary)
        self.archive = stream.getvalue()
        lock = {'version': 'test', 'url': 'https://example.invalid/quickjs.zip', 'member': 'qjs',
                'archive_sha256': hashlib.sha256(self.archive).hexdigest(),
                'binary_sha256': hashlib.sha256(self.binary).hexdigest()}
        (self.root / 'quickjs.lock.json').write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')
        self.archive_path = self.cache / ('quickjs-' + lock['archive_sha256'] + '.zip')
        self.binary_path = self.cache / ('qjs-' + lock['binary_sha256'] + '.com')

    def fetch(self):
        return subprocess.run(self.command, capture_output=True, text=True, encoding='utf-8', timeout=30,
                              env={**os.environ, 'DAIRN_OFFLINE': '1', 'DAIRN_QUICKJS_CACHE': str(self.cache)})

    def test_cached_archive_extracts_only_verified_interpreter(self):
        self.archive_path.write_bytes(self.archive)
        result = self.fetch()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(result.stdout.strip()), self.binary_path)
        self.assertEqual(self.binary_path.read_bytes(), self.binary)
        self.assertEqual({p.name for p in self.cache.iterdir()}, {self.archive_path.name, self.binary_path.name})

    def test_cached_binary_needs_no_archive_or_network(self):
        self.binary_path.write_bytes(self.binary)
        result = self.fetch()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.archive_path.exists())

    def test_corrupt_archive_is_never_executed_or_extracted(self):
        self.archive_path.write_bytes(self.archive + b'corrupt')
        self.assertNotEqual(self.fetch().returncode, 0)
        self.assertFalse(self.binary_path.exists())
        self.assertEqual([p.name for p in self.cache.iterdir()], [self.archive_path.name])

    def test_corrupt_binary_is_rejected(self):
        self.binary_path.write_bytes(b'corrupt')
        self.assertNotEqual(self.fetch().returncode, 0)
        self.assertEqual(self.binary_path.read_bytes(), b'corrupt')

    def test_offline_cache_miss_fails_without_partial_files(self):
        self.assertNotEqual(self.fetch().returncode, 0)
        self.assertEqual(list(self.cache.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
