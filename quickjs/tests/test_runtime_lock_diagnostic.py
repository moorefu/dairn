"""S0/S1: Runtime Lock 漂移必须可诊断、可恢复，且不降低门禁信任。

契约要点：
- `dairn doctor` / `dairn upgrade --plan --json` 漂移时输出稳定 dairn.runtime-lock.v1
  （status、drift[code/expected/actual]、next_actions），并返回 exit 4；
- GATE 命令（validate/check/analyze plan）漂移时 fail closed：exit 4、单行错误、无 JS 堆栈；
- ADVISORY 命令（version/help/docs find/handoff）漂移时仍可只读执行；
- 只读诊断不写入项目；受管编辑保持 conflict/exit 2，lock 不被未授权修改。

需要先构建根目录 runtime/（CI 由 tools/check-source.py 设置 DAIRN_RUNTIME）。
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn')


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class RuntimeLockDiagnostic(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dairn-lock-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'project'
        result = self.call('init', '--name', 'lock_diag', '--stack', 'python')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.lock_path = self.root / '.dairn/lock.json'
        self.lock = json.loads(self.lock_path.read_text(encoding='utf-8'))

    def call(self, *args, env=None):
        command = [str(CLI), *map(str, args), '--root', str(self.root)]
        return subprocess.run(command, env={**os.environ, **(env or {})}, capture_output=True,
                              encoding='utf-8', errors='replace', timeout=180)

    def doctor(self):
        result = self.call('doctor')
        return result, json.loads(result.stdout)

    def git_init(self):
        for command in (['git', 'init', '-q'],
                        ['git', 'config', 'user.email', 'tester@example.test'],
                        ['git', 'config', 'user.name', 'tester'],
                        ['git', 'add', '-A'],
                        ['git', 'commit', '-qm', 'baseline']):
            subprocess.run(command, cwd=self.root, capture_output=True,
                           text=True, timeout=120, check=True)

    def tamper(self, **updates):
        data = dict(self.lock)
        data.update(updates)
        self.lock_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    def test_clean_project_is_ready(self):
        result, report = self.doctor()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(report['status'], 'ready')
        self.assertEqual(report['runtime_lock']['status'], 'ok')
        self.assertEqual(report['runtime_lock']['drift'], [])
        plan = self.call('upgrade', '--plan')
        self.assertEqual(plan.returncode, 0, plan.stdout + plan.stderr)
        payload = json.loads(plan.stdout)
        self.assertEqual(payload['runtime_lock']['status'], 'ok')
        self.assertEqual(payload['runtime_lock']['drift'], [])

    def test_digest_drift_is_diagnosable(self):
        self.tamper(runtime_sha256='0' * 64)
        before = sha256(self.lock_path)
        result, report = self.doctor()
        self.assertEqual(result.returncode, 4, result.stdout + result.stderr)
        self.assertEqual(report['status'], 'drift')
        lock_report = report['runtime_lock']
        self.assertEqual(lock_report['read_only'], True)
        codes = [item['code'] for item in lock_report['drift']]
        self.assertIn('runtime.sha256', codes)
        entry = next(item for item in lock_report['drift'] if item['code'] == 'runtime.sha256')
        self.assertEqual(entry['expected'], '0' * 64)
        self.assertRegex(entry['actual'], r'^[0-9a-f]{64}$')
        commands = [item['command'] for item in lock_report['next_actions']]
        self.assertIn('dairn doctor --json', commands)
        self.assertIn('dairn upgrade --plan --json', commands)
        self.assertTrue(any(item['requires_review'] for item in lock_report['next_actions']))
        # 诊断不得写入项目；plan 也不得写 lock。
        self.assertEqual(sha256(self.lock_path), before)
        plan = self.call('upgrade', '--plan')
        self.assertEqual(plan.returncode, 4, plan.stdout + plan.stderr)
        payload = json.loads(plan.stdout)
        self.assertEqual(payload['runtime_lock']['status'], 'drift')
        self.assertTrue(payload['next_actions'])
        self.assertEqual(sha256(self.lock_path), before)

    def test_version_drift_reports_expected_and_actual(self):
        self.tamper(version='0.0.0-diag')
        result, report = self.doctor()
        self.assertEqual(result.returncode, 4, result.stdout + result.stderr)
        entry = next(item for item in report['runtime_lock']['drift'] if item['code'] == 'runtime.version')
        self.assertEqual(entry['expected'], '0.0.0-diag')
        self.assertNotEqual(entry['actual'], '0.0.0-diag')
        self.assertRegex(entry['actual'] or '', r'^\d+\.\d+')

    def test_managed_edit_stays_conflict_and_never_writes(self):
        skill = self.root / '.agents/skills/dairn-code-review/SKILL.md'
        self.assertTrue(skill.is_file(), skill)
        skill.write_text(skill.read_text(encoding='utf-8') + '\nlocal edit\n', encoding='utf-8')
        result, report = self.doctor()
        self.assertEqual(result.returncode, 4, result.stdout + result.stderr)
        drift = report['runtime_lock']['drift']
        self.assertIn('managed.edited', [item['code'] for item in drift])
        self.assertIn('.agents/skills/dairn-code-review/SKILL.md', [item.get('path') for item in drift])
        before = sha256(self.lock_path)
        plan = self.call('upgrade', '--plan')
        self.assertEqual(plan.returncode, 2, plan.stdout + plan.stderr)
        self.assertEqual(sha256(self.lock_path), before)
        gate = self.call('validate')
        self.assertEqual(gate.returncode, 4, gate.stdout + gate.stderr)

    def test_gate_drift_is_single_line_exit4(self):
        self.tamper(runtime_sha256='1' * 64)
        for gate in (('validate',), ('check', '--all'), ('analyze', 'plan')):
            result = self.call(*gate)
            self.assertEqual(result.returncode, 4, (gate, result.stdout, result.stderr))
            lines = [line for line in result.stderr.splitlines() if line.strip()]
            self.assertEqual(len(lines), 1, (gate, result.stderr))
            self.assertTrue(lines[0].startswith('Runtime Lock drift:'), lines[0])
            self.assertNotIn(' at ', result.stderr)
            self.assertNotIn(' at ', result.stdout)
        # 非零退出且错误稳定，不允许任何策略/证据门禁因漂移而放行。
        self.assertNotEqual(self.call('validate').returncode, 0)

    def test_advisory_commands_remain_read_only_available(self):
        # handoff 依赖 git 仓库；CI 的临时目录不是仓库，先建立最小基线。
        self.git_init()
        self.tamper(runtime_sha256='2' * 64)
        for advisory in (('version',), ('help',), ('docs', 'find', 'launcher'), ('handoff', '--json')):
            result = self.call(*advisory)
            self.assertEqual(result.returncode, 0, (advisory, result.stdout, result.stderr))
        handoff = self.call('handoff', '--json')
        view = json.loads(handoff.stdout)
        self.assertEqual(view['advisory'], True)
        self.assertEqual(view['evidence'], False)

    def test_read_only_diagnostic_does_not_mutate_lock(self):
        before = sha256(self.lock_path)
        self.call('doctor')
        self.call('upgrade', '--plan')
        self.assertEqual(sha256(self.lock_path), before)


if __name__ == '__main__':
    unittest.main()
