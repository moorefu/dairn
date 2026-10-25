"""在独立 Git 夹具中执行真实提升与回滚，不触碰源码仓库 Pin。"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]


class RuntimePromotion(unittest.TestCase):
    def test_process_liveness_preserves_live_processes_and_detects_exited_owners(self):
        with tempfile.TemporaryDirectory(prefix='dairn-process-state-') as directory:
            script = Path(directory) / 'probe.mjs'
            script.write_text('import {host} from '
                + json.dumps((ROOT / 'quickjs/host/qjs.mjs').as_posix()) + ';\n'
                + 'print(JSON.stringify({self:host.processAlive(host.pid()),'
                  'target:host.processAlive(Number(scriptArgs[1])),'
                  'invalid:[0,-1,1.5].map(pid=>host.processAlive(pid))}));\n', encoding='utf-8')
            runtime = os.environ['DAIRN_TEST_RUNTIME']
            invocation = [runtime] if os.name == 'nt' else ['/bin/sh', runtime]

            def probe(pid, env=None):
                result = subprocess.run(invocation + [str(script), str(pid)], cwd=ROOT, env=env,
                    capture_output=True, text=True, timeout=20)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return json.loads(result.stdout)

            process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
            try:
                state = probe(process.pid)
                self.assertIs(state['self'], True)
                self.assertIsNone(process.poll(), '只读存活探测不得终止目标进程')
                self.assertIs(state['target'], True)
                self.assertEqual(state['invalid'], [None, None, None])
                if os.name == 'nt':
                    unavailable = probe(process.pid, {**os.environ, 'SYSTEMROOT': directory})
                    self.assertIsNone(unavailable['target'], '探测工具不可用必须返回未知')
                    self.assertIsNone(process.poll())
            finally:
                if process.poll() is None:
                    process.terminate()
                process.wait(timeout=10)
            self.assertIs(probe(process.pid)['target'], False)

    def test_interrupted_rollback_restores_the_pre_rollback_snapshot(self):
        self.rollback_recovery_case('interrupt')

    def test_rollback_recovery_failure_keeps_a_recoverable_journal(self):
        self.rollback_recovery_case('failure')

    def test_interrupted_rollback_preparation_does_not_read_incomplete_backup(self):
        self.rollback_recovery_case('preparing')

    def test_rollback_before_journal_can_release_only_its_own_abandoned_lock(self):
        self.rollback_recovery_case('before-journal')

    def test_finished_rollback_can_release_its_abandoned_lock(self):
        self.rollback_recovery_case('terminal')

    def test_recovery_refuses_another_transaction_lock(self):
        self.rollback_recovery_case('foreign-lock')

    def test_concurrent_recovery_cannot_release_the_active_recovery_lock(self):
        self.rollback_recovery_case('concurrent')

    def test_interrupted_recovery_with_a_new_lock_can_be_retried(self):
        self.rollback_recovery_case('retry-recovery')

    def rollback_recovery_case(self, failure):
        with tempfile.TemporaryDirectory(prefix='dairn-rollback-recovery-') as directory:
            temp = Path(directory)
            root = temp / 'project'
            transaction = 'interrupted-rollback'
            journal_dir = root / '.dairn/runtime-transactions' / transaction
            (journal_dir / 'backup').mkdir(parents=True)
            (root / '.dairn/runtime').mkdir()
            inputs = []
            for index, (name, before, current) in enumerate([
                ('.dairn/lock.json', b'old-lock', b'new-lock'),
                ('.dairn/runtime/dairn-embedded.com', b'old-runtime', b'new-runtime'),
            ]):
                target = root / name
                target.write_bytes(current)
                (journal_dir / 'backup' / str(index)).write_bytes(before)
                inputs.append({'path': name, 'sha256': hashlib.sha256(before).hexdigest(),
                               'mode': target.stat().st_mode & 0o777})
            journal = journal_dir / 'journal.json'
            journal.write_text(json.dumps({'id': transaction, 'status': 'committed', 'owner_pid': 1,
                'plan': {'from': {'runtime_sha256': 'a' * 64}, 'inputs': inputs}}))
            script = temp / 'rollback.mjs'
            script.write_text('''import * as std from 'std';
import {host} from ''' + json.dumps((ROOT / 'quickjs/host/qjs.mjs').as_posix()) + ''';
import {rollbackRuntime,recoverRuntime} from ''' + json.dumps((ROOT / 'quickjs/core/runtime-promotion.mjs').as_posix()) + ''';
const root=''' + json.dumps(root.as_posix()) + ''';
if(!scriptArgs[1].startsWith('recover')){
  const failure=scriptArgs[1];
  const plan=rollbackRuntime(host,root,{to:'a'.repeat(64)});
  const h={...host,
    mkdirs(path){if(failure==='preparing'&&path.includes('/rollback-current-'))std.exit(97);host.mkdirs(path);},
    rename(from,to){if(failure==='before-journal'&&to.endsWith('/journal.json'))std.exit(97);host.rename(from,to);},
    remove(path){if(failure==='terminal'&&path===root+'/.dairn/runtime-promotion.lock')std.exit(97);host.remove(path);},
    writeBytes(path,data){
      if(failure==='failure'&&path===root+'/.dairn/runtime/dairn-embedded.com')throw Error('夹具模拟占用');
      host.writeBytes(path,data);if(['interrupt','foreign-lock','concurrent','retry-recovery'].includes(failure)&&path===root+'/.dairn/lock.json')std.exit(97);
    }
  };
  try{rollbackRuntime(h,root,{to:'a'.repeat(64),apply:true,reviewedHash:plan.plan_sha256});}
  catch(error){if(failure!=='failure')throw error;std.exit(98);}
}else{
  const h={...host,writeBytes(path,data){
    if(scriptArgs[1]==='recover-slow'){host.write(root+'/recovery-started','yes');host.sleep(1500);}
    host.writeBytes(path,data);if(scriptArgs[1]==='recover-crash')std.exit(99);
  }};
  print(JSON.stringify(recoverRuntime(h,root,{transaction:'interrupted-rollback',apply:true})));
}
''', encoding='utf-8')
            runtime = os.environ['DAIRN_TEST_RUNTIME']
            invocation = [runtime] if os.name == 'nt' else ['/bin/sh', runtime]
            interrupted = subprocess.run(invocation + [str(script), failure], cwd=ROOT,
                capture_output=True, text=True, timeout=30)
            self.assertEqual(interrupted.returncode, 98 if failure == 'failure' else 97,
                             interrupted.stdout + interrupted.stderr)
            mutex = root / '.dairn/runtime-promotion.lock'
            self.assertTrue(mutex.exists())
            if failure == 'foreign-lock':
                original = mutex.read_bytes()
                other = json.dumps({'transaction': 'other-active', 'owner_pid': os.getpid(),
                                    'operation': 'promote'}).encode()
                mutex.write_bytes(other)
                rejected = subprocess.run(invocation + [str(script), 'recover'], cwd=ROOT,
                    capture_output=True, text=True, timeout=30)
                self.assertNotEqual(rejected.returncode, 0)
                self.assertEqual(mutex.read_bytes(), other)
                self.assertEqual((root / '.dairn/lock.json').read_bytes(), b'old-lock')
                self.assertEqual((root / '.dairn/runtime/dairn-embedded.com').read_bytes(), b'new-runtime')
                mutex.write_bytes(original)
            if failure == 'retry-recovery':
                mutex.unlink()
                crashed = subprocess.run(invocation + [str(script), 'recover-crash'], cwd=ROOT,
                    capture_output=True, text=True, timeout=30)
                self.assertEqual(crashed.returncode, 99, crashed.stdout + crashed.stderr)
                self.assertEqual(json.loads(mutex.read_text())['operation'], 'recover')
            if failure == 'concurrent':
                slow = subprocess.Popen(invocation + [str(script), 'recover-slow'], cwd=ROOT,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    deadline = time.monotonic() + 10
                    while not (root / 'recovery-started').exists() and time.monotonic() < deadline and slow.poll() is None:
                        time.sleep(0.05)
                    self.assertTrue((root / 'recovery-started').exists())
                    refused = subprocess.run(invocation + [str(script), 'recover'], cwd=ROOT,
                        capture_output=True, text=True, timeout=10)
                    self.assertNotEqual(refused.returncode, 0)
                    self.assertTrue(mutex.exists())
                    stdout, stderr = slow.communicate(timeout=10)
                    recovered = subprocess.CompletedProcess([], slow.returncode, stdout, stderr)
                finally:
                    if slow.poll() is None:
                        slow.kill()
                        slow.wait(timeout=5)
            else:
                recovered = subprocess.run(invocation + [str(script), 'recover'], cwd=ROOT,
                    capture_output=True, text=True, timeout=30)
            self.assertEqual(recovered.returncode, 0, recovered.stdout + recovered.stderr)
            self.assertEqual((root / '.dairn/lock.json').read_bytes(), b'old-lock' if failure == 'terminal' else b'new-lock')
            self.assertEqual((root / '.dairn/runtime/dairn-embedded.com').read_bytes(), b'old-runtime' if failure == 'terminal' else b'new-runtime')
            self.assertEqual(json.loads(journal.read_text())['status'], 'rolled-back' if failure == 'terminal' else 'committed')
            self.assertFalse(mutex.exists())

    def test_promotion_preparation_failure_and_missing_journal_are_recoverable(self):
        for failure in ('backup', 'before-journal'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory(prefix='dairn-promotion-prepare-') as directory:
                temp = Path(directory)
                root, source = temp / 'project', temp / 'installed'
                (root / '.dairn/runtime').mkdir(parents=True)
                source.mkdir()
                (root / '.dairn/lock.json').write_text(json.dumps({'version': 'old',
                    'runtime_sha256': 'a' * 64, 'managed': {}}))
                (root / '.dairn/runtime/dairn-embedded.com').write_bytes(b'old')
                (root / '.dairn/runtime/runtime-integrity.json').write_text('{}')
                (source / 'dairn-embedded.com').write_bytes(b'new')
                (source / 'runtime-integrity.json').write_text(json.dumps({'engine_version': 'new',
                    'sha256': hashlib.sha256(b'new').hexdigest()}))
                script = temp / 'prepare.mjs'
                script.write_text('''import * as std from 'std';
import {host} from ''' + json.dumps((ROOT / 'quickjs/host/qjs.mjs').as_posix()) + ''';
import {promotionPlan,applyPromotion,recoverRuntime} from ''' + json.dumps((ROOT / 'quickjs/core/runtime-promotion.mjs').as_posix()) + ''';
const root=''' + json.dumps(root.as_posix()) + ''',source=''' + json.dumps(source.as_posix()) + ''';
if(scriptArgs[1]==='recover')print(JSON.stringify(recoverRuntime(host,root,{transaction:scriptArgs[2],apply:true})));
else{
  const h={...host,env:name=>name==='DAIRN_RUNTIME_DIR'?source:host.env(name),
    rename(from,to){if(scriptArgs[1]==='before-journal'&&to.endsWith('/journal.json'))std.exit(97);host.rename(from,to);},
    writeBytes(path,data){if(scriptArgs[1]==='backup'&&path.includes('/backup/'))throw Error('夹具模拟备份失败');host.writeBytes(path,data);}
  };
  const plan=promotionPlan(h,root,{version:'new',identity:'b'.repeat(64),managedPlan:{actions:[],full:{}}});
  try{applyPromotion(h,root,plan,{reviewedHash:plan.plan_sha256,activate(){throw Error('不得激活');},verify:()=>true});}
  catch(error){std.exit(98);}
}
''', encoding='utf-8')
                runtime = os.environ['DAIRN_TEST_RUNTIME']
                invocation = [runtime] if os.name == 'nt' else ['/bin/sh', runtime]
                result = subprocess.run(invocation + [str(script), failure], cwd=ROOT,
                    capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 98 if failure == 'backup' else 97, result.stdout + result.stderr)
                transaction, = (root / '.dairn/runtime-transactions').iterdir()
                mutex = root / '.dairn/runtime-promotion.lock'
                if failure == 'before-journal':
                    recovered = subprocess.run(invocation + [str(script), 'recover', transaction.name], cwd=ROOT,
                        capture_output=True, text=True, timeout=30)
                    self.assertEqual(recovered.returncode, 0, recovered.stdout + recovered.stderr)
                self.assertFalse(mutex.exists())
                self.assertEqual((root / '.dairn/runtime/dairn-embedded.com').read_bytes(), b'old')
                self.assertEqual(json.loads((transaction / 'journal.json').read_text())['status'],
                                 'rolled-back' if failure == 'backup' else 'aborted')

    def test_plan_apply_rollback_and_ordinary_upgrade_freeze(self):
        with tempfile.TemporaryDirectory(prefix='dairn-promotion-') as directory:
            temp = Path(directory)
            root = temp / 'project'
            env = {**os.environ, 'DAIRN_RUNTIME': os.environ['DAIRN_TEST_RUNTIME']}

            def call(*args, environment=env):
                return subprocess.run([str(ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn')), *args,
                    '--root', str(root)], cwd=ROOT, env=environment, capture_output=True, text=True, timeout=120)

            result = call('init', '--stack', 'python', '--name', 'promotion')
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            for argv in (['init'], ['config', 'user.name', '测试'], ['config', 'user.email', 'test@example.invalid'], ['add', '.'], ['commit', '-qm', '固定夹具']):
                subprocess.run(['git', '-c', 'commit.gpgSign=false', *argv], cwd=root, check=True, capture_output=True)
            pin = root / '.dairn/runtime/dairn-embedded.com'
            old = hashlib.sha256(pin.read_bytes()).hexdigest()
            old_identity = json.loads((root / '.dairn/lock.json').read_text())['runtime_sha256']
            candidate = temp / 'candidate'
            built = subprocess.run([sys.executable, '-B', 'tools/build.py', '--out', str(temp / 'artifacts'),
                '--runtime-out', str(candidate)], cwd=ROOT, env={**env, 'DAIRN_BUILD_TIME': '2026-10-25T00:00:01Z'}, capture_output=True, text=True, timeout=120)
            self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
            other = {**env, 'DAIRN_RUNTIME': str(candidate / 'dairn-embedded.com')}
            result = call('upgrade', '--apply', environment=other)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('RUNTIME_PROMOTION_REQUIRED', result.stderr)
            self.assertEqual(hashlib.sha256(pin.read_bytes()).hexdigest(), old)
            planned = call('runtime', 'promote', '--source', 'installed', '--plan', '--json', environment=other)
            self.assertEqual(planned.returncode, 0, planned.stdout + planned.stderr)
            plan = json.loads(planned.stdout)
            self.assertEqual(hashlib.sha256(pin.read_bytes()).hexdigest(), old)
            bad = call('runtime', 'promote', '--source', 'installed', '--apply', '--plan-sha256', '0' * 64, environment=other)
            self.assertNotEqual(bad.returncode, 0)
            applied = call('runtime', 'promote', '--source', 'installed', '--apply', '--plan-sha256', plan['plan_sha256'], environment=other)
            self.assertEqual(applied.returncode, 0, applied.stdout + applied.stderr)
            self.assertNotEqual(hashlib.sha256(pin.read_bytes()).hexdigest(), old)
            rollback = call('runtime', 'rollback', '--to', old_identity, '--plan', environment=other)
            self.assertEqual(rollback.returncode, 0, rollback.stdout + rollback.stderr)
            rollback_plan = json.loads(rollback.stdout)
            restored = call('runtime', 'rollback', '--to', old_identity, '--apply', '--plan-sha256', rollback_plan['plan_sha256'], environment=other)
            self.assertEqual(restored.returncode, 0, restored.stdout + restored.stderr)
            self.assertEqual(hashlib.sha256(pin.read_bytes()).hexdigest(), old)
