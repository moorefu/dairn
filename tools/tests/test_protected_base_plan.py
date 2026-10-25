"""真实 Git Base/Head：Head 降低策略不改变当前矩阵，全局契约实际执行。"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ProtectedBasePlan(unittest.TestCase):
    @unittest.skipIf(os.name == 'nt', '受控工具替身使用 POSIX shebang')
    def test_governance_execute_dispatches_builtin_lint_without_path_dairn(self):
        with tempfile.TemporaryDirectory(prefix='dairn-builtin-executor-') as directory:
            temp = Path(directory)
            project, tools, calls = temp / 'project', temp / 'tools', temp / 'ruff.jsonl'
            tools.mkdir()
            fixture = ('#!' + sys.executable + '\nimport json, os, sys, time\n'
                       + 'with open(os.environ["RUFF_FIXTURE_LOG"], "a") as stream: stream.write(json.dumps(sys.argv[1:])+"\\n")\n'
                       + 'time.sleep(float(os.environ.get("RUFF_FIXTURE_DELAY", "0")))\n'
                       + 'sys.exit(int(os.environ.get("RUFF_FIXTURE_EXIT", "0")))\n')
            (tools / 'ruff').write_text(fixture, encoding='utf-8')
            (tools / 'ruff').chmod(0o755)
            (tools / 'dairn').write_text('#!/bin/sh\necho "不应调用 PATH 中的 Dairn" >&2\nexit 99\n')
            (tools / 'dairn').chmod(0o755)
            env = {**os.environ, 'DAIRN_RUNTIME': os.environ['DAIRN_TEST_RUNTIME'],
                   'PATH': str(tools) + os.pathsep + os.environ['PATH'], 'RUFF_FIXTURE_LOG': str(calls)}

            def call(*args):
                return subprocess.run([str(ROOT / 'dairn'), *args, '--root', str(project)],
                                      cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)

            created = call('init', '--stack', 'python', '--name', 'builtin_fixture')
            self.assertEqual(created.returncode, 0, created.stdout + created.stderr)
            policy_path = project / '.dairn/governance/project.json'
            policy = json.loads(policy_path.read_text())
            for name, config in policy['modules'][0]['checks'].items():
                if name == 'lint':
                    self.assertEqual(config['argv'], ['dairn', 'stack-check', 'python', 'lint'])
                    config['timeout'] = 1
                else:
                    config['argv'] = [sys.executable, '-B', '-c', 'print("真实检查")']
            policy_path.write_text(json.dumps(policy), encoding='utf-8')
            for args in (['init', '-q'], ['config', 'user.name', '测试'],
                         ['config', 'user.email', 'test@example.invalid'], ['add', '.'],
                         ['commit', '-qm', '默认内置 lint 配置']):
                subprocess.run(['git', '-c', 'commit.gpgSign=false', *args], cwd=project,
                               check=True, capture_output=True)
            base = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=project, text=True).strip()
            (project / 'feature.py').write_text('value = 1\n')
            subprocess.run(['git', 'add', '.'], cwd=project, check=True, capture_output=True)
            subprocess.run(['git', '-c', 'commit.gpgSign=false', 'commit', '-qm', '实现变更'],
                           cwd=project, check=True, capture_output=True)
            executed = call('governance', 'execute', '--base', base, '--timeout', '10')
            self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)
            self.assertEqual([json.loads(line) for line in calls.read_text().splitlines()],
                             [['check', '.'], ['format', '--check', '.']])
            env['RUFF_FIXTURE_EXIT'] = '7'
            failed = call('governance', 'execute', '--base', base, '--timeout', '10')
            self.assertEqual(failed.returncode, 1, failed.stdout + failed.stderr)
            lint = next(check for check in json.loads(failed.stdout)['checks'] if check['id'] == 'lint')
            self.assertEqual(lint['exit_code'], 7)
            env.pop('RUFF_FIXTURE_EXIT')
            env['RUFF_FIXTURE_DELAY'] = '3'
            timed = call('governance', 'execute', '--base', base, '--timeout', '10')
            self.assertEqual(timed.returncode, 1, timed.stdout + timed.stderr)
            lint = next(check for check in json.loads(timed.stdout)['checks'] if check['id'] == 'lint')
            self.assertEqual(lint['status'], 'timeout')

    def test_work_verifies_same_base_policy_and_snapshot_boundary(self):
        with tempfile.TemporaryDirectory(prefix='dairn-work-base-policy-') as directory:
            project = Path(directory) / 'project'
            cli = ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn')
            env = {**os.environ, 'DAIRN_RUNTIME': os.environ['DAIRN_TEST_RUNTIME']}

            def call(*args):
                return subprocess.run([str(cli), *args, '--root', str(project)], cwd=ROOT, env=env,
                                      capture_output=True, text=True, timeout=120)

            def passed(*args):
                result = call(*args)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result

            def git(*args):
                return subprocess.check_output(['git', '-c', 'commit.gpgSign=false', *args],
                                               cwd=project, text=True, stderr=subprocess.STDOUT).strip()

            passed('init', '--stack', 'python', '--name', 'work_base_fixture')
            policy_path = project / '.dairn/governance/project.json'
            policy = json.loads(policy_path.read_text())
            for config in policy['modules'][0]['checks'].values():
                config['argv'] = [sys.executable, '-B', '-c', 'print("真实检查成功")']
            policy_path.write_text(json.dumps(policy), encoding='utf-8')
            ignore = project / '.gitignore'
            ignore.write_text(ignore.read_text() + '\ngenerated-output/\n', encoding='utf-8')
            git('init', '-q')
            git('config', 'user.name', '测试')
            git('config', 'user.email', 'test@example.invalid')
            git('add', '.')
            git('commit', '-qm', 'Base 四项检查')
            base = git('rev-parse', 'HEAD')
            policy['snapshot_exclusions'] = ['generated-output/']
            policy_path.write_text(json.dumps(policy), encoding='utf-8')
            git('add', '.dairn/governance/project.json')
            git('commit', '-qm', 'Head 仅增加排除项')
            head_policy = policy_path.read_text()
            passed('work', 'start', '实现 Base 策略绑定', '--id', 'base-policy', '--kind', 'change')
            for _ in range(4):
                passed('work', 'skip', 'base-policy', '--reason', '隔离回归的范围已预定')
            passed('check', '--task', 'base-policy', '--base', base)
            run_path, = list((project / '.dairn/governance/evidence/runs').rglob('run.json'))
            run = json.loads(run_path.read_text())
            self.assertEqual(run['status'], 'passed')
            self.assertEqual(run['declared_assurance'], 'local-observed')
            self.assertEqual(len(run['checks']), 4)
            passed('work', 'verify', 'base-policy', '--require-machine-gates')

            # Head 提议的排除项不能隐藏 Base Run 完成后才出现的未知输入。
            generated = project / 'generated-output' / 'new-input.txt'
            generated.parent.mkdir()
            generated.write_text('检查结束后新增的输入', encoding='utf-8')
            changed = call('work', 'verify', 'base-policy', '--require-machine-gates')
            self.assertEqual(changed.returncode, 2, changed.stdout + changed.stderr)
            self.assertIn('Worktree changed since machine run', changed.stdout)
            generated.unlink()
            passed('work', 'verify', 'base-policy', '--require-machine-gates')

            # 同一 HEAD 的旧成功保留为历史，新成功可覆盖当前工作区的适用性。
            source = project / 'feature.py'
            source.write_text('value = 1\n', encoding='utf-8')
            passed('check', '--task', 'base-policy', '--base', base)
            passed('work', 'verify', 'base-policy', '--require-machine-gates')
            source.write_text('value = 2\n', encoding='utf-8')
            changed = call('work', 'verify', 'base-policy', '--require-machine-gates')
            self.assertEqual(changed.returncode, 2, changed.stdout + changed.stderr)
            self.assertIn('Worktree changed since machine run', changed.stdout)
            source.write_text('value = 1\n', encoding='utf-8')
            passed('work', 'verify', 'base-policy', '--require-machine-gates')
            old_run = run_path.read_text()
            run_path.write_text(old_run + '\n', encoding='utf-8')
            changed = call('work', 'verify', 'base-policy', '--require-machine-gates')
            self.assertEqual(changed.returncode, 2, changed.stdout + changed.stderr)
            self.assertIn('Machine evidence digest mismatch', changed.stdout)
            run_path.write_text(old_run, encoding='utf-8')
            passed('work', 'verify', 'base-policy', '--require-machine-gates')

            # 无 Base 的完整检查继续绑定当前策略；与 Base Run 可共同引用。
            previous_runs = set((project / '.dairn/governance/evidence/runs').rglob('run.json'))
            passed('check', '--all')
            baseline_path, = set((project / '.dairn/governance/evidence/runs').rglob('run.json')) - previous_runs
            baseline = json.loads(baseline_path.read_text())
            self.assertIsNone(baseline['subject']['base_commit'])
            passed('work', 'link-check', 'base-policy', '--run', baseline['run_id'])
            passed('work', 'verify', 'base-policy', '--require-machine-gates')
            policy['snapshot_exclusions'].append('other-output/')
            policy_path.write_text(json.dumps(policy), encoding='utf-8')
            changed = call('work', 'verify', 'base-policy', '--require-machine-gates')
            self.assertEqual(changed.returncode, 2, changed.stdout + changed.stderr)
            self.assertIn('Worktree changed since machine run', changed.stdout)
            self.assertIn('Policy changed since machine run', changed.stdout)
            policy_path.write_text(head_policy, encoding='utf-8')
            passed('work', 'verify', 'base-policy', '--require-machine-gates')

    def test_policy_approval_floor_and_requirement_id_conflict(self):
        with tempfile.TemporaryDirectory(prefix='dairn-plan-contract-') as directory:
            script = Path(directory) / 'plan.mjs'
            script.write_text('import {planGovernance} from '
                              + json.dumps((ROOT / 'quickjs/core/governance-plan.mjs').as_posix()) + ';\n' + '''
const module = {name:'app',path:'.',checks:{unit:{argv:['python','-c','print(1)']}}};
const base = {schema:'dairn.policy.v1',risk:{levels:['L0','L1','L2'],default:'L1'},
  checks:{L0:['unit'],L1:['unit'],L2:['unit']},modules:[module],approvals:{L0:{required:false}}};
const change = {paths:['app/feature.py'],modules:[module],risk:'L0'};
const plan = (policy=base, extra={}) => planGovernance({trustedPolicy:policy,change,...extra}).plan;
const results = {opt_out:plan().approvals,default_l2:plan(base,{change:{...change,risk:'L2'}}).approvals,
  organization_required:plan(base,{organizationPolicy:{...base,approvals:{L0:{required:true}}}}).approvals,
  organization_count:plan(base,{organizationPolicy:{...base,approvals:{L0:{min_count:2}}}}).approvals};
try { plan(base,{refactorContracts:[{id:'app',paths:['.'],baseline:{contracts:['unit']}}]});
  results.conflict = null;
} catch (error) { results.conflict=String(error); }
print(JSON.stringify(results));
''', encoding='utf-8')
            runtime = os.environ['DAIRN_TEST_RUNTIME']
            command = [runtime] if os.name == 'nt' else ['/bin/sh', runtime]
            result = subprocess.run(command + [str(script)], cwd=ROOT, capture_output=True,
                                    text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            plans = json.loads(result.stdout)
            self.assertEqual(plans['opt_out'], [])
            self.assertGreaterEqual(plans['default_l2'][0]['min_count'], 1)
            self.assertGreaterEqual(plans['organization_required'][0]['min_count'], 1)
            self.assertEqual(plans['organization_count'][0]['min_count'], 2)
            self.assertIn('REQUIREMENT_ID_CONFLICT', plans['conflict'] or '')

    def test_head_cannot_lower_base_and_global_requirement_runs(self):
        with tempfile.TemporaryDirectory(prefix='dairn-base-policy-') as directory:
            project = Path(directory) / 'project'
            cli = ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn')
            env = {**os.environ, 'DAIRN_RUNTIME': os.environ['DAIRN_TEST_RUNTIME']}

            def call(*args):
                return subprocess.run([str(cli), *args, '--root', str(project)], cwd=ROOT, env=env,
                                      capture_output=True, text=True, timeout=120)

            initialized = call('init', '--stack', 'python', '--name', 'base_fixture')
            self.assertEqual(initialized.returncode, 0, initialized.stdout + initialized.stderr)
            path = project / '.dairn/governance/project.json'
            policy = json.loads(path.read_text())
            for config in policy['modules'][0]['checks'].values():
                config['argv'] = [sys.executable, '-B', '-c', 'print("真实必需检查")']
            policy['repository_checks'] = {'compat': {'argv': [sys.executable, '-B', '-c', 'print("全局兼容检查")'], 'cwd': '.'}}
            path.write_text(json.dumps(policy))
            contracts = project / '.dairn/governance/refactors'
            contracts.mkdir()
            contract = {'schema': 'dairn.refactor.v1', 'id': 'global-api', 'intent': 'behavior-preserving',
                        'baseline': {'source_commit': 'a' * 40, 'contracts': ['compat']},
                        'target': {'properties': ['stable-api']}, 'migration': {'strategy': 'incremental'},
                        'debt': {'allowed_transitional_items': [], 'known_failures': []}, 'paths': ['.']}
            (contracts / 'global-api.json').write_text(json.dumps(contract))
            for args in (['init', '-q'], ['config', 'user.name', '测试'], ['config', 'user.email', 'test@example.invalid'], ['add', '.'], ['commit', '-qm', '受信基线']):
                subprocess.run(['git', '-c', 'commit.gpgSign=false', *args], cwd=project, capture_output=True, check=True)
            base = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=project, text=True).strip()
            policy['required_checks']['L2'] = ['lint']
            policy['modules'][0]['checks'] = {}
            policy['repository_checks'] = {}
            path.write_text(json.dumps(policy))
            subprocess.run(['git', 'add', '.'], cwd=project, check=True, capture_output=True)
            subprocess.run(['git', '-c', 'commit.gpgSign=false', 'commit', '-qm', 'Head 提议降级'], cwd=project, check=True, capture_output=True)
            result = call('governance', 'plan', '--base', base, '--json')
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            envelope = json.loads(result.stdout)
            self.assertGreaterEqual(envelope['plan']['approvals'][0]['min_count'], 1,
                                    '必需自然人审批的默认下限不能是零')
            self.assertEqual({r['id'] for r in envelope['plan']['requirements']},
                             {'app.lint', 'app.unit', 'app.integration', 'app.build', 'global-api.compat'})
            executed = call('governance', 'execute', '--base', base, '--plan-sha256', envelope['plan_sha256'], '--json')
            self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)
            run = json.loads(executed.stdout)
            self.assertEqual(run['execution']['check_plan_sha256'], envelope['plan_sha256'])
            self.assertTrue(any(c['module'] is None and c['id'] == 'compat' and c['status'] == 'passed' for c in run['checks']))
            self.assertEqual(run['declared_assurance'], 'local-observed')

    def test_regular_check_honors_executor_timeout_from_base_plan(self):
        with tempfile.TemporaryDirectory(prefix='dairn-base-timeout-') as directory:
            project = Path(directory) / 'project'
            cli = ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn')
            env = {**os.environ, 'DAIRN_RUNTIME': os.environ['DAIRN_TEST_RUNTIME']}

            def call(*args):
                return subprocess.run([str(cli), *args, '--root', str(project)], cwd=ROOT, env=env,
                                      capture_output=True, text=True, timeout=120)

            initialized = call('init', '--stack', 'python', '--name', 'timeout_fixture')
            self.assertEqual(initialized.returncode, 0, initialized.stdout + initialized.stderr)
            path = project / '.dairn/governance/project.json'
            policy = json.loads(path.read_text())
            for config in policy['modules'][0]['checks'].values():
                config['argv'] = [sys.executable, '-B', '-c', 'print("必需检查")']
            policy['modules'][0]['checks']['unit'].update(
                argv=[sys.executable, '-B', '-c', 'import time; time.sleep(3)'], timeout=1)
            path.write_text(json.dumps(policy), encoding='utf-8')
            for args in (['init', '-q'], ['config', 'user.name', '测试'],
                         ['config', 'user.email', 'test@example.invalid'], ['add', '.'],
                         ['commit', '-qm', '受信超时配置']):
                subprocess.run(['git', '-c', 'commit.gpgSign=false', *args], cwd=project,
                               capture_output=True, check=True)
            base = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=project, text=True).strip()
            (project / 'feature.py').write_text('value = 1\n', encoding='utf-8')
            subprocess.run(['git', 'add', '.'], cwd=project, check=True, capture_output=True)
            subprocess.run(['git', '-c', 'commit.gpgSign=false', 'commit', '-qm', '需要单测的变更'],
                           cwd=project, check=True, capture_output=True)
            checked = call('check', '--base', base, '--timeout', '10')
            self.assertEqual(checked.returncode, 1, checked.stdout + checked.stderr)
            runs = list((project / '.dairn/governance/evidence/runs').rglob('run.json'))
            self.assertEqual(len(runs), 1)
            run = json.loads(runs[0].read_text())
            unit = next(check for check in run['checks'] if check['id'] == 'unit')
            self.assertEqual(unit['status'], 'timeout')
            self.assertEqual(run['status'], 'failed')
