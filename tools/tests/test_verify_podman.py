"""离线 Linux 验收编排：锁定缓存、非 root 场景与运行失败证据。"""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))


class PodmanVerification(unittest.TestCase):
    def exercise(self,*,tampered=False,start_failure=False,out_file=False):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'tools').mkdir()
            script=root/'tools/verify-podman.py'
            shutil.copyfile(ROOT/'tools/verify-podman.py',script)
            digest=hashlib.sha256(b'locked-bootstrap').hexdigest()
            (root/'quickjs.lock.json').write_text(json.dumps({'binary_sha256':digest}))
            cache=root/'cache';cache.mkdir()
            (cache/('qjs-'+digest+'.com')).write_bytes(b'changed' if tampered else b'locked-bootstrap')
            calls=[]
            if out_file:(root/'results').write_text('不是目录')

            def output(argv,**kwargs):
                calls.append(argv)
                if argv[1:3]==['image','inspect']:
                    return json.dumps([{'Id':'pinned-image','RepoDigests':[]}]).encode()
                return 'container-id\n' if argv[1]=='create' else b'0\n'

            def run(argv,**kwargs):
                calls.append(argv)
                if start_failure and argv[1]=='start':
                    raise subprocess.TimeoutExpired(argv,3600)
                return subprocess.CompletedProcess(argv,0)

            def prepare(_root,destination,_archive):
                destination.mkdir()
                (destination/'dairn').write_text('launcher')
                return destination

            outcome=None
            with patch.object(sys,'argv',[str(script),'--runtime-zip',str(root/'dairn-0.1.0-nightly.20261025000000.zip'),
                    '--quickjs-cache',str(cache),'--test-user','dairn-test','--out',str(root/'results')]), \
                 patch('subprocess.check_output',side_effect=output),patch('subprocess.run',side_effect=run), \
                 patch('source_workspace.prepare_workspace',side_effect=prepare), \
                 contextlib.redirect_stderr(io.StringIO()):
                try:runpy.run_path(str(script),run_name='__main__')
                except SystemExit as error:outcome=error.code
                except subprocess.TimeoutExpired:outcome='timeout'
                except FileExistsError:outcome='out-file'
            summary=root/'results/podman.json'
            return calls,outcome,json.loads(summary.read_text()) if summary.exists() else None

    def test_network_off_locked_cache_and_nonroot_runner(self):
        calls,code,summary=self.exercise()
        self.assertEqual(code,0)
        create=next(argv for argv in calls if argv[1]=='create')
        self.assertEqual(create[create.index('--network')+1],'none')
        self.assertIn('DAIRN_OFFLINE=1',create)
        self.assertIn('runuser -u dairn-test',create[-1])
        self.assertIn('with-built-runtime.py',create[-1])
        self.assertIn('/dairn-0.1.0-nightly.20261025000000.zip',create[-1])
        self.assertTrue(any(argv[1]=='cp' and argv[3]=='container-id:/dairn-0.1.0-nightly.20261025000000.zip' for argv in calls))
        self.assertEqual(summary['test_user'],'dairn-test')
        self.assertEqual(summary['returncode'],0)

    def test_changed_bootstrap_is_refused_before_container_creation(self):
        calls,code,_=self.exercise(tampered=True)
        self.assertEqual(code,2)
        self.assertFalse(any(argv[1]=='create' for argv in calls))

    def test_timeout_keeps_diagnostics_and_removes_only_own_container(self):
        calls,code,summary=self.exercise(start_failure=True)
        self.assertEqual(code,124)
        self.assertEqual(summary['returncode'],124)
        self.assertTrue(summary['timed_out'])
        self.assertIn(['podman','stop','--time','5','container-id'],calls)
        self.assertTrue(any(argv[1]=='cp' and argv[2]=='container-id:/results/.' for argv in calls))
        self.assertIn(['podman','logs','container-id'],calls)
        self.assertIn(['podman','rm','--force','container-id'],calls)

    def test_unwritable_output_rejected_before_container_creation(self):
        calls,code,_=self.exercise(out_file=True)
        self.assertEqual(code,'out-file')
        self.assertFalse(any(argv[1]=='create' for argv in calls))
