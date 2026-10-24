"""A-02/A-03/Q-01/C-02 integration tests: analyze run/import, suites, adapters,
quality fitness and participation plans. Official CLI, real subprocesses.

契约要点：Analysis Run / Observation / Fitness / Participation Plan 全部是
advisory 机器观察，任何一层都不得自宣 CI 受信或 Gate 放行（负向断言覆盖）。
"""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / 'dairn.sh'

SARIF = {
    "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    "version": "2.1.0",
    "runs": [{
        "tool": {"driver": {"name": "test-scanner"}},
        "results": [
            {"ruleId": "sec.sql-injection", "level": "error",
             "message": {"text": "string concatenation in query"},
             "locations": [{"physicalLocation": {"artifactLocation": {"uri": "src/db.go"},
                                                 "region": {"startLine": 12}}}],
             "fingerprints": {"dairn/v1": "sec-1"}},
            {"ruleId": "style.naming", "level": "note",
             "message": {"text": "variable naming"},
             "locations": [{"physicalLocation": {"artifactLocation": {"uri": "src/util.go"}}}]},
        ],
    }],
}
JUNIT = ('<?xml version="1.0" encoding="UTF-8"?>\n'
         '<testsuites tests="3" failures="1" errors="0" skipped="1">\n'
         '<testsuite name="core" tests="3" failures="1" errors="0" skipped="1">\n'
         '<testcase classname="core" name="ok"/>\n'
         '<testcase classname="core" name="bad"><failure message="assert">boom</failure></testcase>\n'
         '<testcase classname="core" name="later"><skipped/></testcase>\n'
         '</testsuite>\n</testsuites>\n')


class AnalyzeQualityCapability(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dairn-aq-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'project'
        self.run_dairn('init', '--path', self.root, '--stack', 'go', '--sample', root=False)
        self.git('init', '-q')
        self.git('config', 'user.email', 't@example.test')
        self.git('config', 'user.name', 'T')

    def run_dairn(self, *args, root=True, ok=True):
        cmd = [str(CLI), *[str(a) for a in args]]
        if root:
            cmd += ['--root', str(self.root)]
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if ok:
            self.assertEqual(p.returncode, 0, p.stdout + '\n' + p.stderr)
        return p

    def obj(self, *args, **kw):
        return json.loads(self.run_dairn(*args, **kw).stdout)

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.root, capture_output=True, text=True, check=True).stdout.strip()

    def commit(self, msg='baseline'):
        self.git('add', '.')
        self.git('commit', '-qm', msg)
        return self.git('rev-parse', 'HEAD')

    def registry(self, doc):
        (self.root / '.dairn/analyzers.json').write_text(json.dumps(doc) + '\n')

    # ---- A-02: analyze run + suite ----
    def test_analyze_run_produces_analysis_run_v1(self):
        base = self.commit()
        (self.root / 'api.py').write_text('def a():\n    return 1\n')
        self.commit('change')
        self.run_dairn('analyzers', 'init', '--template', 'python', '--id', 'py-api', '--apply')
        out = self.obj('analyze', 'run', 'py-api', '--base', base, '--json')
        run = out['runs'][0]
        self.assertEqual(run['schema'], 'dairn.analysis-run.v1')
        self.assertEqual(run['status'], 'completed')
        self.assertEqual(run['analyzer_id'], 'py-api')
        self.assertEqual(run['assurance'], 'local-observed')
        self.assertIn('never a gate verdict', run['note'])
        self.assertTrue(run['changes_count'] >= 1)
        self.assertEqual(run['observation']['schema'], 'dairn.quality-observation.v1')

    def test_suite_execution_and_unknown_target(self):
        base = self.commit()
        self.run_dairn('analyzers', 'init', '--template', 'python', '--id', 'a1', '--apply')
        doc = json.loads((self.root / '.dairn/analyzers.json').read_text())
        doc['suites'] = [{'id': 's-all', 'analyzers': ['a1']}]
        self.registry(doc)
        out = self.obj('analyze', 'run', '--suite', 's-all', '--base', base, '--json')
        self.assertEqual(out['summary']['completed'], 1)
        missing = self.run_dairn('analyze', 'run', '--suite', 'nope', ok=False)
        self.assertNotEqual(missing.returncode, 0)
        bad_ref = json.loads((self.root / '.dairn/analyzers.json').read_text())
        bad_ref['suites'] = [{'id': 's-bad', 'analyzers': ['ghost']}]
        self.registry(bad_ref)
        self.assertNotEqual(self.run_dairn('analyze', 'run', '--suite', 's-bad', ok=False).returncode, 0)

    def test_tool_failure_records_status_not_crash(self):
        self.commit()
        doc = {'schema': 'dairn.analyzers.v1', 'analyzers': [
            {'id': 'broken', 'domain': 'surface', 'execution': {'argv': ['git', 'does-not-exist'], 'cwd': '.'}}]}
        self.registry(doc)
        p = self.run_dairn('analyze', 'run', 'broken', '--json', ok=False)
        self.assertEqual(p.returncode, 2)
        out = json.loads(p.stdout)
        self.assertIn(out['runs'][0]['status'], ('tool-error', 'report-error', 'invalidated'))

    # ---- A-03: adapters + import ----
    def test_import_sarif_and_junit(self):
        (self.root / 'reports').mkdir()
        (self.root / 'reports/security.sarif').write_text(json.dumps(SARIF))
        (self.root / 'reports/tests.xml').write_text(JUNIT)
        self.registry({'schema': 'dairn.analyzers.v1', 'analyzers': [
            {'id': 'ci-sarif', 'domain': 'security', 'mode': 'import',
             'report': {'path': 'reports/security.sarif', 'format': 'sarif-2.1.0'}},
            {'id': 'ci-junit', 'domain': 'test', 'mode': 'import',
             'report': {'path': 'reports/tests.xml', 'format': 'junit-xml'}},
        ]})
        sarif = self.obj('analyze', 'import', 'ci-sarif', '--json')
        self.assertEqual(sarif['assurance'], 'unverified-import')
        self.assertEqual(sarif['observation']['schema'], 'dairn.quality-observation.v1')
        rules = [f['rule_id'] for f in sarif['observation']['findings']]
        self.assertIn('sec.sql-injection', rules)
        junit = self.obj('analyze', 'import', 'ci-junit', '--json')
        self.assertEqual(junit['observation']['tests'], {'total': 3, 'failed': 1, 'errored': 0, 'skipped': 1})

    def test_import_refuses_doctype_and_missing_report(self):
        (self.root / 'reports').mkdir()
        (self.root / 'reports/evil.xml').write_text(
            '<?xml version="1.0"?><!DOCTYPE testsuites [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
            '<testsuites><testsuite tests="0"></testsuite></testsuites>')
        self.registry({'schema': 'dairn.analyzers.v1', 'analyzers': [
            {'id': 'evil', 'domain': 'test', 'mode': 'import',
             'report': {'path': 'reports/evil.xml', 'format': 'junit-xml'}},
            {'id': 'gone', 'domain': 'test', 'mode': 'import',
             'report': {'path': 'reports/missing.xml', 'format': 'junit-xml'}},
        ]})
        self.assertNotEqual(self.run_dairn('analyze', 'import', 'evil', ok=False).returncode, 0)
        self.assertNotEqual(self.run_dairn('analyze', 'import', 'gone', ok=False).returncode, 0)
        # 无报告 ≠ 零发现：缺失文件必须失败，绝不生成空 PASS。

    # ---- Q-01: quality fitness ----
    def test_quality_fitness_pass_fail_unknown(self):
        (self.root / '.dairn/governance').mkdir(exist_ok=True)
        (self.root / 'reports').mkdir()
        (self.root / 'reports/security.sarif').write_text(json.dumps(SARIF))
        base = self.commit()
        (self.root / 'api.py').write_text('def b(x):\n    return x\n')
        self.commit('change')
        self.run_dairn('analyzers', 'init', '--template', 'python', '--id', 'py-api', '--apply')
        self.registry({'schema': 'dairn.analyzers.v1', 'analyzers': [
            {'id': 'py-api', 'domain': 'surface', 'execution': {'argv': ['python3', 'tools/dairn/analyzers/python/main.py'], 'cwd': '.', 'timeout_seconds': 120}},
            {'id': 'ci-sarif', 'domain': 'security', 'mode': 'import',
             'report': {'path': 'reports/security.sarif', 'format': 'sarif-2.1.0'}},
        ]})
        goals = {'schema': 'dairn.quality-goals.v1', 'objectives': [
            {'id': 'no-error-findings', 'attribute': 'security', 'type': 'regression',
             'metric': 'findings.error-count', 'operator': '<=', 'threshold': 0,
             'producer': 'ci-sarif', 'enforcement': 'required'},
            {'id': 'surface-stable', 'attribute': 'compatibility', 'type': 'regression',
             'metric': 'surface.changes', 'operator': '<=', 'threshold': 0,
             'producer': 'py-api', 'enforcement': 'required'},
            {'id': 'missing-data', 'attribute': 'coverage', 'type': 'trend',
             'metric': 'tests.failed', 'operator': '<=', 'threshold': 0,
             'producer': 'no-such-analyzer', 'enforcement': 'advisory'},
        ]}
        (self.root / '.dairn/governance/quality-goals.json').write_text(json.dumps(goals))
        # surface 分析需要 base 才能计算签名差；缺 base 时 producer 只能 UNKNOWN
        p = self.run_dairn('quality', 'fitness', '--base', base, '--json', ok=False)
        out = json.loads(p.stdout)
        self.assertEqual(p.returncode, 1)  # required FAIL
        self.assertEqual(out['status'], 'FAIL')
        verdicts = {r['objective_id']: r['status'] for r in out['results']}
        self.assertEqual(verdicts['no-error-findings'], 'FAIL')
        self.assertEqual(verdicts['surface-stable'], 'FAIL')
        self.assertEqual(verdicts['missing-data'], 'UNKNOWN')
        self.assertIn('never approves', out['note'])

    def test_quality_fitness_no_goals_is_zero_ceremony(self):
        out = self.obj('quality', 'fitness', '--json')
        self.assertEqual(out['status'], 'NO-GOALS')

    # ---- C-02: capability plan ----
    def test_capability_plan_gap_and_advisory(self):
        (self.root / '.dairn/governance').mkdir(exist_ok=True)
        base = self.commit()
        (self.root / 'auth').mkdir(exist_ok=True)
        (self.root / 'auth/token.go').write_text('package auth\nfunc Issue(){}\n')
        self.commit('security change')
        goals = {'schema': 'dairn.quality-goals.v1', 'objectives': [
            {'id': 'cov-trend', 'attribute': 'coverage', 'type': 'trend',
             'metric': 'tests.failed', 'producer': 'ghost', 'enforcement': 'advisory'}]}
        (self.root / '.dairn/governance/quality-goals.json').write_text(json.dumps(goals))
        p = self.run_dairn('capability', 'plan', '--base', base, '--json', ok=False)
        out = json.loads(p.stdout)
        self.assertEqual(p.returncode, 3)  # security gap
        self.assertTrue(any(g['capability'] == 'security.threat-analysis' for g in out['gaps']))
        self.assertTrue(any(n['capability'] == 'quality.tests.failed' for n in out['needs']))
        plan_text = json.dumps(out)
        self.assertNotIn('gate_override', plan_text)
        self.assertNotIn('"approved"', plan_text)
        self.assertIn('never starts models', out['note'])

    # ---- I-01/I-02 ----
    def test_governance_plan_and_handoff_carry_quality_context(self):
        (self.root / '.dairn/governance').mkdir(exist_ok=True)
        goals = {'schema': 'dairn.quality-goals.v1', 'objectives': [
            {'id': 'no-err', 'attribute': 'security', 'type': 'regression',
             'metric': 'findings.error-count', 'operator': '<=', 'threshold': 0,
             'producer': 'ci-sarif', 'enforcement': 'required'}]}
        (self.root / '.dairn/governance/quality-goals.json').write_text(json.dumps(goals))
        base = self.commit()
        (self.root / 'api.go').write_text('package hello\nfunc C(){}\n')
        self.commit('change')
        plan = self.obj('governance', 'plan', '--base', base, '--json')
        self.assertTrue(plan['plan']['quality_goals']['configured'])
        self.assertIn('no-err', plan['plan']['quality_goals']['required'])
        hand = self.obj('handoff', '--base', base, '--json')
        self.assertIn('analyzers', json.dumps(hand))


if __name__ == '__main__':
    unittest.main()
