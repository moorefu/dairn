"""轻量集成：真实 Git 项目、四项门禁、失败与超时证据、离线 vendor 升级。"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn')
CHECK = '''import ast
import json
from pathlib import Path
import subprocess
import sys
from calculator import total

stage = sys.argv[1]
source = Path('calculator.py').read_text(encoding='utf-8')
if stage == 'lint':
    ast.parse(source)
elif stage == 'unit':
    assert total([6, 7]) == 13
elif stage == 'integration':
    result = subprocess.run([sys.executable, '-B', '-c',
                             'from calculator import total; print(total([6, 7]))'],
                            capture_output=True, text=True, timeout=3, check=True)
    assert result.stdout.strip() == '13'
elif stage == 'build':
    compile(source, 'calculator.py', 'exec')
else:
    raise ValueError(stage)
output = Path('.dairn/tmp')
output.mkdir(parents=True, exist_ok=True)
(output / (stage + '.json')).write_text(json.dumps({'stage': stage, 'total': total([6, 7])}), encoding='utf-8')
print(stage + ': PASS')
'''


class LightIntegration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dairn-light-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / '项目 空格'
        self.env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1',
                    'GIT_CEILING_DIRECTORIES': self.temp.name}
        self.out = Path(os.environ.get('DAIRN_TEST_EVIDENCE_DIR', ROOT / 'validation/light-integration'))
        self.out.mkdir(parents=True, exist_ok=True)
        self.sequence = 0

    def call(self, *args, expected=0, vendored=False):
        # 新布局：唯一启动器在项目根（dairn / dairn.cmd），不再有 .dairn/bin 第二层。
        cli = self.root / ('dairn.cmd' if os.name == 'nt' else 'dairn') if vendored else CLI
        command = [str(cli), *map(str, args), '--root', str(self.root)]
        result = subprocess.run(command, cwd=self.temp.name, env=self.env,
                                capture_output=True, encoding='utf-8', errors='replace', timeout=60)
        self.sequence += 1
        (self.out / f'{self.sequence:02d}-{args[0]}.log').write_text(
            result.stdout + result.stderr, encoding='utf-8')
        if expected is not None:
            self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def check(self, label, expected, timeout=5):
        directory = self.root / '.dairn/governance/evidence'
        before = set(directory.rglob('run.json'))
        result = self.call('check', '--all', '--base', self.base, '--timeout', timeout, expected=None)
        created = set(directory.rglob('run.json')) - before
        audits = set(directory.glob('execution-*.json'))
        if created:
            self.assertEqual(len(created), 1, '检查必须生成一份新的真实 Run')
            path = created.pop()
        else:
            self.assertTrue(audits, '检查必须生成真实执行审计记录')
            path = max(audits, key=lambda item: item.stat().st_mtime)
        run = json.loads(path.read_text(encoding='utf-8'))
        self.assertIn(run['schema'], ('dairn.check-run.v1', 'dairn.execution-record.v1'))
        if run['schema'] == 'dairn.check-run.v1':
            self.assertEqual(run['subject']['source_commit'], self.base)
        shutil.copyfile(path, self.out / (label + '-' + run['schema'].split('.')[-2] + '.json'))
        if expected is not None:
            self.assertEqual(result.returncode, expected,
                             result.stdout + result.stderr + json.dumps(run['checks'], ensure_ascii=False))
        return run

    def test_checks_and_vendor_lifecycle(self):
        self.call('init', '--name', 'light_demo', '--stack', 'python', '--ci', 'none')
        (self.root / 'calculator.py').write_text('def total(values):\n    return sum(values)\n', encoding='utf-8')
        (self.root / 'check.py').write_text(CHECK, encoding='utf-8')
        policy_path = self.root / '.dairn/governance/project.json'
        policy = json.loads(policy_path.read_text(encoding='utf-8'))
        for stage, check in policy['modules'][0]['checks'].items():
            check['argv'] = [sys.executable, '-B', 'check.py', stage]
        policy_path.write_text(json.dumps(policy, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        for args in [('init', '-q'), ('config', 'user.name', 'Dairn Integration'),
                     ('config', 'user.email', 'dairn-test@example.invalid'), ('add', '.'),
                     ('-c', 'commit.gpgSign=false', 'commit', '-qm', '集成测试基线')]:
            subprocess.run(['git', *args], cwd=self.root, env=self.env, capture_output=True, check=True, timeout=15)
        self.base = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.root,
                                            env=self.env, text=True, timeout=15).strip()
        self.call('doctor')
        self.call('validate')
        passed = self.check('passed', 0)
        self.assertEqual(passed['status'], 'passed')
        self.assertEqual({x['id'] for x in passed['checks']}, {'lint', 'unit', 'integration', 'build'})
        self.assertTrue(all(x['status'] == 'passed' and x['exit_code'] == 0 for x in passed['checks']))
        for stage in ('lint', 'unit', 'integration', 'build'):
            output = json.loads((self.root / '.dairn/tmp' / (stage + '.json')).read_text(encoding='utf-8'))
            self.assertEqual(output, {'stage': stage, 'total': 13})

        # 策略声明的生成物边界（snapshot_exclusions）让忽略的构建产物不再把
        # 输入覆盖率判成 incomplete，同时不能隐藏真实输入。
        ignorefile = self.root / '.gitignore'
        existing = ignorefile.read_text(encoding='utf-8') if ignorefile.exists() else ''
        ignorefile.write_text(existing + 'build-output/\n', encoding='utf-8')
        (self.root / 'build-output').mkdir(exist_ok=True)
        (self.root / 'build-output' / 'artifact.bin').write_bytes(b'\x00\x01')
        policy['snapshot_exclusions'] = ['build-output/']
        policy_path.write_text(json.dumps(policy, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        covered = self.check('coverage', 0)
        self.assertEqual(covered['execution']['input_coverage'], 'declared-complete')
        self.assertEqual(covered['status'], 'passed')
        policy.pop('snapshot_exclusions')
        policy_path.write_text(json.dumps(policy, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        uncovered = self.check('coverage-missing', None)
        self.assertEqual(uncovered['execution']['input_coverage'], 'incomplete')
        self.assertEqual(uncovered['status'], 'invalidated')
        policy['snapshot_exclusions'] = ['build-output/']
        policy_path.write_text(json.dumps(policy, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

        policy['modules'][0]['checks']['unit']['argv'] = [sys.executable, '-c', 'raise SystemExit(13)']
        policy_path.write_text(json.dumps(policy), encoding='utf-8')
        failed = self.check('failed', 1)
        self.assertEqual(failed['status'], 'failed')
        self.assertEqual(next(x['exit_code'] for x in failed['checks'] if x['id'] == 'unit'), 13)

        policy['modules'][0]['checks']['unit']['argv'] = [sys.executable, '-c', 'import time; time.sleep(3)']
        policy_path.write_text(json.dumps(policy), encoding='utf-8')
        timed = self.check('timeout', 1, timeout=1)
        unit = next(x for x in timed['checks'] if x['id'] == 'unit')
        self.assertEqual(unit['status'], 'timeout')
        self.assertIsNone(unit['exit_code'])

        vendor = self.root / '.dairn/runtime'
        vendor.mkdir(parents=True, exist_ok=True)
        for name in ('dairn-embedded.com', 'runtime-integrity.json'):
            shutil.copyfile(Path(os.environ['DAIRN_TEST_RUNTIME']).parent / name, vendor / name)
        if os.name != 'nt':
            (vendor / 'dairn-embedded.com').chmod(0o755)
        self.call('upgrade', '--vendor-runtime', '.dairn/runtime', '--plan')
        self.call('upgrade', '--vendor-runtime', '.dairn/runtime', '--apply')
        self.call('version', vendored=True)
        self.call('invalid-command', expected=2, vendored=True)
        self.call('doctor', vendored=True)
        self.call('validate', vendored=True)


if __name__ == '__main__':
    unittest.main()
