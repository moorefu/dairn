"""dairn context / analyze plan 集成测试：分层上下文包与能力驱动的按需选择。

契约要点（负向断言覆盖）：
- 上下文包只做证据组装，每个命中都带来源与精度；缺失必须显式为 UNKNOWN。
- Analyzer Selection Planner 默认 dry run，不执行任何外部工具；缺口必须显式。
- 两者都不得自宣 Gate 放行或替代受信策略。
"""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn.sh')
# Cosmopolitan 的 fd 表变量指向未继承句柄，Python 再启动 APE 孙进程时必须清空。
ENV = {key: value for key, value in os.environ.items()
       if key not in ('_COSMO_FDS', '_COSMO_FDS_V2', 'DAIRN_RUNTIME', 'DAIRN_RUNTIME_SOURCE')}


class ContextAndAnalyzerPlan(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dairn-ctx-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'project'
        self.run_dairn('init', '--path', self.root, '--stack', 'go', '--sample', root=False)
        self.git('init', '-q')
        self.git('config', 'user.email', 't@example.test')
        self.git('config', 'user.name', 'T')

    # ---- 基础工具 ----
    def run_dairn(self, *args, root=True, ok=True):
        cmd = [str(CLI), *[str(a) for a in args]]
        if root:
            cmd += ['--root', str(self.root)]
        process = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace',
                               timeout=180, env=ENV)
        if ok:
            self.assertEqual(process.returncode, 0, process.stdout + '\n' + process.stderr)
        return process

    def obj(self, *args, **kwargs):
        return json.loads(self.run_dairn(*args, **kwargs).stdout)

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.root, capture_output=True, text=True, check=True).stdout.strip()

    def commit(self, message='baseline'):
        self.git('add', '-A')
        self.git('commit', '-qm', message)
        return self.git('rev-parse', 'HEAD')

    def write(self, rel, text):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
        return path

    # ---- dairn context ----
    def test_context_pack_json_contract(self):
        head = self.commit()
        pack = self.obj('context', 'durable retry', '--json')
        self.assertEqual(pack['schema'], 'dairn.context-pack.v1')
        self.assertEqual(pack['query'], 'durable retry')
        self.assertIn('durable', pack['query_terms'])
        self.assertIn(pack['status'], ('ok', 'partial', 'empty'))
        self.assertEqual(pack['subject']['head'], head)
        self.assertRegex(pack['pack_sha256'], r'^[0-9a-f]{64}$')
        for layer in ('text_matches', 'symbols', 'unknowns', 'minimal_files', 'limitations'):
            self.assertIsInstance(pack[layer], list, layer)
        self.assertLessEqual(len(pack['minimal_files']), 12)
        self.assertEqual(pack['change']['status'], 'not-requested')
        self.assertFalse(pack['requested_change'])
        self.assertIn(pack['relations']['status'], ('available', 'absent'))
        self.assertIn(pack['analysis_plan']['status'],
                      ('ready', 'needs-authorization', 'missing-capability', 'unavailable'))
        self.assertIn('head', pack['provenance'])
        self.assertEqual(pack['provenance']['precision'], 'observed-static+text')
        self.assertIn('git', pack['provenance']['sources'])
        for unknown in pack['unknowns']:
            self.assertIsInstance(unknown['kind'], str)
            self.assertTrue(unknown['detail'])

    def test_context_text_and_symbol_matches_keep_provenance(self):
        self.write('src/refund_retry.py', 'def refund_retry(order):\n    return order\n')
        self.commit('add refund retry')
        pack = self.obj('context', 'refund_retry', '--json')
        hits = [hit for hit in pack['text_matches'] if hit['path'] == 'src/refund_retry.py']
        self.assertTrue(hits, 'git grep 命中的文本位置必须带 path/line')
        self.assertEqual(hits[0]['path'], 'src/refund_retry.py')
        self.assertIsInstance(hits[0]['line'], int)
        self.assertGreaterEqual(hits[0]['line'], 1)
        symbol_paths = {symbol['path'] for symbol in pack['symbols']}
        self.assertIn('src/refund_retry.py', symbol_paths)
        minimal = [item['path'] for item in pack['minimal_files']]
        self.assertIn('src/refund_retry.py', minimal)
        reasons = [item for item in pack['minimal_files'] if item['path'] == 'src/refund_retry.py'][0]['reasons']
        self.assertTrue(any('text-match' in reason or 'symbol:' in reason for reason in reasons), reasons)

    def test_context_change_layer_binds_trusted_base_or_reports_unknown(self):
        self.run_dairn('guide', 'facts', '--apply')
        base = self.commit('baseline facts')
        self.write('src/refund.py', 'def refund():\n    return 2\n')
        pack = self.obj('context', 'refund', '--change', '--base', base, '--json')
        self.assertTrue(pack['requested_change'])
        self.assertEqual(pack['subject']['base_commit'], base)
        self.assertNotEqual(pack['change']['status'], 'not-requested')
        kinds = [unknown['kind'] for unknown in pack['unknowns']]
        self.assertNotIn('UNBASELINED_CHANGE', kinds)
        self.assertNotEqual(pack['governance']['status'], 'not-requested')
        bare = self.obj('context', 'refund', '--change', '--json')
        self.assertEqual(bare['change']['status'], 'not-requested')
        self.assertIn('CHANGE_CONTEXT_UNAVAILABLE', [unknown['kind'] for unknown in bare['unknowns']])

    def test_context_focus_limits_and_out_guard(self):
        self.commit()
        focused = self.obj('context', 'refund', '--for', 'threat-analysis', '--json')
        self.assertEqual(focused['focus']['name'], 'threat-analysis')
        self.assertEqual(focused['focus']['suggested_capabilities'], ['security.scan'])
        unknown_focus = self.obj('context', 'refund', '--for', 'not-a-persona', '--json')
        self.assertEqual(unknown_focus['focus']['suggested_capabilities'], [])
        limited = self.obj('context', 'refund', '--limit', '3', '--json')
        self.assertLessEqual(len(limited['minimal_files']), 3)
        bad_limit = self.run_dairn('context', 'refund', '--limit', '0', '--json', ok=False)
        self.assertEqual(bad_limit.returncode, 2, bad_limit.stderr)
        self.assertIn('--limit', bad_limit.stderr)
        out = self.obj('context', 'refund', '--out', 'artifacts/context.json', '--json')
        written = json.loads((self.root / 'artifacts/context.json').read_text(encoding='utf-8'))
        self.assertEqual(written['schema'], 'dairn.context-pack.v1')
        self.assertEqual(written['pack_sha256'], out['pack_sha256'])
        again = self.run_dairn('context', 'refund', '--out', 'artifacts/context.json', '--json', ok=False)
        self.assertEqual(again.returncode, 2)
        self.assertIn('refuse to overwrite', again.stderr)
        govern = self.run_dairn('context', 'refund', '--out', '.dairn/governance/pack.json', '--json', ok=False)
        self.assertEqual(govern.returncode, 2)
        self.assertIn('governance evidence tree', govern.stderr)
        # --out 不改变 stdout：没有 --json 时仍输出人类可读的渲染结果。
        rendered = self.run_dairn('context', 'refund', '--out', 'artifacts/context-rendered.json')
        self.assertFalse(rendered.stdout.lstrip().startswith('{'), rendered.stdout[:80])
        rendered_file = json.loads((self.root / 'artifacts/context-rendered.json').read_text(encoding='utf-8'))
        self.assertEqual(rendered_file['schema'], 'dairn.context-pack.v1')

    # ---- dairn analyze plan ----
    def test_analyze_plan_is_dry_run_by_default(self):
        head = self.commit()
        plan = self.obj('analyze', 'plan', '--json')
        self.assertEqual(plan['schema'], 'dairn.analyzer-plan.v1')
        self.assertEqual(plan['subject']['head'], head)
        self.assertEqual(plan['policy']['source'], 'default')
        self.assertEqual(plan['policy']['auto_execute'], [])
        self.assertRegex(plan['plan_sha256'], r'^[0-9a-f]{64}$')
        self.assertEqual(plan['summary']['execute'], 0)
        self.assertEqual(plan['status'], 'ready')
        for limitation in plan['limitations']:
            self.assertIsInstance(limitation, str)
        self.assertIn('advisory', plan['limitations'][0])
        # --out 只写文件，不改变 stdout（默认仍是人类可读的渲染结果）。
        plan_out = self.run_dairn('analyze', 'plan', '--out', 'artifacts/plan.json')
        self.assertFalse(plan_out.stdout.lstrip().startswith('{'), plan_out.stdout[:80])
        written_plan = json.loads((self.root / 'artifacts/plan.json').read_text(encoding='utf-8'))
        self.assertEqual(written_plan['schema'], 'dairn.analyzer-plan.v1')

    def test_analyze_plan_derives_change_needs_from_trusted_base(self):
        self.run_dairn('guide', 'facts', '--apply')
        base = self.commit('baseline facts')
        self.write('src/refund.py', 'def refund():\n    return 2\n')
        self.commit('change refund')
        plan = self.obj('analyze', 'plan', '--base', base, '--json')
        self.assertEqual(plan['subject']['base_commit'], base)
        capabilities = [decision['capability'] for decision in plan['decisions']]
        self.assertIn('change.impact', capabilities)
        self.assertEqual(plan['summary']['execute'], 0)
        for decision in plan['decisions']:
            self.assertIn(decision['action'], ('builtin', 'reuse', 'execute', 'request-authorization', 'gap'))
            if decision['priority'] == 'required':
                self.assertNotEqual(decision['action'], 'reuse')
        self.assertFalse((self.root / '.dairn/governance/evidence/analysis-runs').exists(),
                         'dry run 不得执行 analyzer 或写入运行证据')

    def test_analyze_plan_reports_missing_capability_and_rejects_bad_policy(self):
        policy = {
            'schema': 'dairn.analysis-policy.v1',
            'required': [{'capability': 'coverage.summary', 'when': 'always'}],
        }
        self.write('.dairn/governance/analysis.json', json.dumps(policy) + '\n')
        self.commit('require coverage')
        process = self.run_dairn('analyze', 'plan', '--json', ok=False)
        self.assertEqual(process.returncode, 3, process.stderr)
        plan = json.loads(process.stdout)
        self.assertEqual(plan['status'], 'missing-capability')
        self.assertEqual(plan['gaps'][0]['capability'], 'coverage.summary')
        self.assertEqual(plan['gaps'][0]['reason'], 'NO_PROVIDER')
        self.assertGreaterEqual(plan['summary']['gaps_required'], 1)
        self.write('.dairn/governance/analysis.json', json.dumps({
            'schema': 'dairn.analysis-policy.v1', 'unknown_key': True,
        }) + '\n')
        broken = self.run_dairn('analyze', 'plan', '--json', ok=False)
        self.assertEqual(broken.returncode, 2, broken.stdout)
        self.assertIn('Analysis policy', broken.stderr)


if __name__ == '__main__':
    unittest.main()
