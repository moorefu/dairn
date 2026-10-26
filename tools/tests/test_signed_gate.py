"""真实 Ed25519 验签：签名 Run 可以通过，复用 run_id 的伪造内容必须拒绝。"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(shutil.which('openssl'), '需要 OpenSSL 的真实签名验证')
class SignedGate(unittest.TestCase):
    def test_machine_signature_keeps_approval_snapshot_in_explicit_audit_scope(self):
        with tempfile.TemporaryDirectory(prefix='dairn-signed-approval-') as directory:
            temp, project = Path(directory), Path(directory) / 'project'
            cli = ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn')
            env = {**os.environ, 'DAIRN_RUNTIME': os.environ['DAIRN_TEST_RUNTIME']}

            def call(*args):
                return subprocess.run([str(cli), *args, '--root', str(project)], cwd=ROOT,
                                      env=env, capture_output=True, text=True, timeout=120)

            def passed(*args):
                result = call(*args)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result

            passed('init', '--stack', 'python', '--name', 'approval_fixture')
            policy_path = project / '.dairn/governance/project.json'
            initialized = json.loads(policy_path.read_text())
            for config in initialized['modules'][0]['checks'].values():
                config['argv'] = [sys.executable, '-B', '-c', 'print("真实检查")']
            policy = {'schema': 'dairn.policy.v1', 'risk': {'levels': ['L0', 'L1', 'L2'], 'default': 'L1'},
                      'checks': initialized['required_checks'], 'modules': initialized['modules'],
                      'approvals': {'L1': {'required': True, 'min_count': 1}}}
            policy_path.write_text(json.dumps(policy), encoding='utf-8')
            for args in (['init', '-q'], ['config', 'user.name', '测试'], ['config', 'user.email', 'test@example.invalid'],
                         ['add', '.'], ['commit', '-qm', '需要审批的策略']):
                subprocess.run(['git', '-c', 'commit.gpgSign=false', *args], cwd=project,
                               capture_output=True, check=True)
            base = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=project, text=True).strip()
            (project / 'feature.py').write_text('value = 1\n')
            subprocess.run(['git', 'add', '.'], cwd=project, check=True, capture_output=True)
            subprocess.run(['git', '-c', 'commit.gpgSign=false', 'commit', '-qm', '需要检查的源码变更'],
                           cwd=project, check=True, capture_output=True)
            run = json.loads(passed('governance', 'execute', '--base', base).stdout)
            evidence = project / '.dairn/governance/evidence'
            rel = '.dairn/governance/evidence/'
            (evidence / 'subject.json').write_text(json.dumps(run['subject']))
            run_path, = evidence.rglob('run.json')
            key, public = temp / 'key.pem', temp / 'public.pem'
            for args in (['genpkey', '-algorithm', 'Ed25519', '-out', str(key)],
                         ['pkey', '-in', str(key), '-pubout', '-out', str(public)]):
                subprocess.run(['openssl', *args], check=True, capture_output=True)
            approval = {'schema': 'dairn.approval-verdict.v1', 'provider': 'github', 'status': 'PASS',
                        'subject': {'repository': run['subject']['repository'], 'number': 1,
                                    'reviewed_head_sha': run['subject']['source_commit']},
                        'eligible_reviewer_ids': ['reviewer'], 'review_ids': ['review-1'],
                        'rule_ids': ['required-review'], 'reasons': [], 'observed_at': '2026-10-25T00:00:00Z'}
            for index, (stage, status) in enumerate((('post-merge', 'PASS'), ('release', 'PASS'), ('post-merge', 'FAIL'))):
                approval.update(status=status, reasons=[] if status == 'PASS' else ['fixture approval rejected'])
                approval_path = evidence / 'approval.json'
                approval_path.write_text(json.dumps(approval), encoding='utf-8')
                original = approval_path.read_text()
                suffix = str(index)
                bundle, statement, signature = (rel + name + suffix for name in ('bundle-', 'statement-', 'signature-'))
                context = {'provider': 'fixture', 'repository': run['subject']['repository'], 'pipeline_id': 'fixture-1',
                           'build_job_id': 'job-1', 'source_commit': run['subject']['source_commit'], 'stage': stage}
                (evidence / 'context.json').write_text(json.dumps(context))
                passed('evidence', 'bundle', '--run', run['run_id'], '--approval', rel + 'approval.json', '--out', bundle)
                bundled = json.loads((project / bundle).read_text())
                expected = hashlib.sha256(original.encode()).hexdigest()
                self.assertEqual(bundled['files']['approval_snapshot']['sha256'], expected)
                if index == 0:
                    approval_path.write_text(original + '\n', encoding='utf-8')
                    self.assertEqual(call('evidence', 'verify', '--bundle', bundle).returncode, 1)
                    invalid = call('attest', 'prepare', '--bundle', bundle, '--context', rel + 'context.json', '--out', statement)
                    self.assertNotEqual(invalid.returncode, 0, invalid.stdout + invalid.stderr)
                    approval_path.write_text(original, encoding='utf-8')
                passed('attest', 'prepare', '--bundle', bundle, '--context', rel + 'context.json', '--out', statement)
                signed = json.loads((project / statement).read_text())
                self.assertEqual(signed['scope'], 'machine-assurance')
                self.assertEqual(signed['human_approval'], 'delegated-to-scm')
                self.assertNotIn('approval_snapshot_sha256', signed['digests'])
                self.assertEqual(signed['audit']['scope'], 'snapshot-bytes-only')
                self.assertEqual(signed['audit']['approval_snapshot_sha256'], expected)
                subprocess.run(['openssl', 'pkeyutl', '-sign', '-inkey', str(key), '-rawin', '-in', str(project / statement),
                                '-out', str(project / signature)], check=True, capture_output=True)
                args = ['gate', 'evaluate', '--subject', rel + 'subject.json', '--policy', '.dairn/governance/project.json',
                        '--check', run_path.relative_to(project).as_posix(),
                        '--attestation', statement, '--signature', signature, '--key', str(public), '--context', rel + 'context.json',
                        '--stage', stage, '--risk', 'L1', '--json']
                result = call(*args)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(json.loads(result.stdout)['human_approval'], 'delegated-to-scm')
                if index == 0:
                    approval_path.write_text(original + '\n', encoding='utf-8')
                    tampered = call(*args)
                    self.assertEqual(tampered.returncode, 0, tampered.stdout + tampered.stderr)
                    self.assertEqual(call('evidence', 'verify', '--bundle', bundle).returncode, 1)

    def test_actual_signature_and_forged_run_bytes(self):
        with tempfile.TemporaryDirectory(prefix='dairn-signature-') as directory:
            temp = Path(directory)
            project = temp / 'project'
            env = {**os.environ, 'DAIRN_RUNTIME': os.environ['DAIRN_TEST_RUNTIME']}
            cli = ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn')

            def call(*args):
                return subprocess.run([str(cli), *args, '--root', str(project)], cwd=ROOT,
                                      env=env, capture_output=True, text=True, timeout=120)

            created = call('init', '--stack', 'python', '--name', 'signed_fixture')
            self.assertEqual(created.returncode, 0, created.stdout + created.stderr)
            policy_path = project / '.dairn/governance/project.json'
            policy = json.loads(policy_path.read_text())
            for config in policy['modules'][0]['checks'].values():
                config['argv'] = [sys.executable, '-B', '-c', 'print("真实检查")']
            policy_path.write_text(json.dumps(policy), encoding='utf-8')
            for args in (['init', '-q'], ['config', 'user.name', '测试'], ['config', 'user.email', 'test@example.invalid'], ['add', '.'], ['commit', '-qm', '签名夹具']):
                subprocess.run(['git', '-c', 'commit.gpgSign=false', *args], cwd=project, capture_output=True, check=True)
            checked = call('check', '--all')
            self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)
            runs = list((project / '.dairn/governance/evidence/runs').rglob('run.json'))
            self.assertEqual(len(runs), 1)
            run_path = runs[0]
            run = json.loads(run_path.read_text())
            evidence = project / '.dairn/governance/evidence'
            (evidence / 'subject.json').write_text(json.dumps(run['subject']))
            bundled = call('evidence', 'bundle', '--run', run['run_id'], '--out', '.dairn/governance/evidence/bundle.json')
            self.assertEqual(bundled.returncode, 0, bundled.stdout + bundled.stderr)
            (evidence / 'context.json').write_text(json.dumps({'provider': 'fixture', 'repository': run['subject']['repository'],
                'pipeline_id': 'fixture-1', 'build_job_id': 'job-1', 'source_commit': run['subject']['source_commit']}))
            prepared = call('attest', 'prepare', '--bundle', '.dairn/governance/evidence/bundle.json',
                '--context', '.dairn/governance/evidence/context.json', '--out', '.dairn/governance/evidence/statement.json')
            self.assertEqual(prepared.returncode, 0, prepared.stdout + prepared.stderr)
            key, public = temp / 'key.pem', temp / 'public.pem'
            for args in (['genpkey', '-algorithm', 'Ed25519', '-out', str(key)],
                         ['pkey', '-in', str(key), '-pubout', '-out', str(public)],
                         ['pkeyutl', '-sign', '-inkey', str(key), '-rawin', '-in', str(evidence / 'statement.json'), '-out', str(evidence / 'signature')]):
                subprocess.run(['openssl', *args], capture_output=True, check=True)
            args = ['gate', 'evaluate', '--subject', '.dairn/governance/evidence/subject.json', '--policy', '.dairn/governance/project.json',
                    '--check', run_path.relative_to(project).as_posix(), '--attestation', '.dairn/governance/evidence/statement.json',
                    '--signature', '.dairn/governance/evidence/signature', '--key', str(public), '--stage', 'post-merge', '--json']
            passed = call(*args)
            self.assertEqual(passed.returncode, 0, passed.stdout + passed.stderr)
            run['checks'][0]['argv'] = ['forged-command']
            run_path.write_text(json.dumps(run))
            forged = call(*args)
            self.assertEqual(forged.returncode, 1, forged.stdout + forged.stderr)
            self.assertIn('RUN_DIGEST_MISMATCH', forged.stdout)
