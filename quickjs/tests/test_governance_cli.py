"""governance/refactor CLI end-to-end (consolidated plan §5/§12/§13/§15).

Exercises the real launcher against a real git repository: deterministic
plans, capability assessment, refactor contracts with debt baselines, and
evidence-honest feedback. Pure semantics live in test_gov_native.mjs.
"""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / 'dairn.sh'


class GovernanceCLI(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='dairn-govcli-')
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name) / 'repo'
        self.call('init', '--path', self.repo, '--stack', 'go', '--sample')
        self.git('init', '-q')
        self.git('config', 'user.name', 'Tester')
        self.git('config', 'user.email', 'tester@example.test')
        self.git('add', '.')
        self.git('commit', '-qm', 'baseline')

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.repo, capture_output=True, text=True, check=True).stdout.strip()

    def call(self, *args, ok=False):
        proc = subprocess.run([str(CLI), *map(str, args), '--root', self.repo],
                              capture_output=True, text=True, timeout=180)
        if ok:
            self.assertEqual(proc.returncode, 0, proc.stdout + '\n' + proc.stderr)
        return proc

    def obj(self, *args):
        return json.loads(self.call(*args, '--json', ok=True).stdout)

    def commit_change(self, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        self.git('add', '.')
        self.git('commit', '-qm', 'change ' + path.name)
        return self.git('rev-parse', 'HEAD')

    def test_plan_l0_docs_change_is_minimum_ceremony(self):
        head = self.commit_change(self.repo / 'docs' / 'note.md', 'docs edit\n')
        base = self.git('rev-parse', 'HEAD^')
        out = self.obj('governance', 'plan', '--base', base)
        plan = out['plan']
        self.assertEqual(plan['schema'], 'dairn.governance-plan.v1')
        self.assertEqual(plan['classification']['effective_risk'], 'L0')
        self.assertEqual([r['check_id'] for r in plan['requirements']], ['lint'])
        self.assertEqual(plan['advisory_workflow'], [])
        self.assertFalse(plan['work_required'])
        self.assertEqual(plan['change_paths'], ['docs/note.md'])
        self.assertEqual(plan['subject']['source_commit'], head)
        self.assertNotIn(out['plan_sha256'], json.dumps(plan))
        # explain renders the human-readable reasoning chain
        text = self.call('governance', 'explain', '--base', base, ok=True).stdout
        self.assertIn('Governance plan explanation', text)
        self.assertIn('never by this plan', text)

    def test_plan_l2_keeps_full_matrix_and_reports_capability_gaps(self):
        self.commit_change(self.repo / 'auth.go', 'package hello\nfunc VerifyToken(s string) bool { return len(s) > 0 }\n')
        base = self.git('rev-parse', 'HEAD^')
        policy_path = self.repo / '.dairn/governance/project.json'
        policy = json.loads(policy_path.read_text())
        self.assertEqual(policy['required_checks']['L2'], ['lint', 'unit', 'integration', 'build'])
        plan = self.obj('governance', 'plan', '--base', base)['plan']
        self.assertEqual(plan['classification']['effective_risk'], 'L2')
        self.assertEqual(len(plan['requirements']), 4)
        self.assertEqual(plan['approvals'], [{'authority': 'scm-native', 'natural_person': True,
                                              'required': True, 'origin': 'risk-L2'}])
        self.assertEqual(plan['status'], 'ready-to-execute')
        # Remove the integration executor: the plan must report the gap and exit nonzero.
        del policy['modules'][0]['checks']['integration']
        policy_path.write_text(json.dumps(policy))
        gap = self.call('governance', 'plan', '--base', base)
        self.assertNotEqual(gap.returncode, 0, 'missing capability must not plan as ready')
        self.assertIn('MISSING_CAPABILITY', gap.stderr + gap.stdout)

    def test_assess_grades_capabilities_without_self_certifying(self):
        out = self.obj('governance', 'assess')
        self.assertEqual(out['schema'], 'dairn.capability-assessment.v1')
        checks = {c['check_id']: c for c in out['modules'][0]['checks']}
        self.assertEqual(checks['lint']['status'], 'detected')  # dairn stack-check is built-in
        self.assertNotIn('ci-verified', json.dumps(out))

    def test_recommend_is_honest_about_thin_history(self):
        out = self.obj('governance', 'recommend')
        self.assertEqual(out['status'], 'insufficient-evidence')
        self.assertEqual(out['recommendations'], [])

    def test_refactor_contract_lifecycle(self):
        self.commit_change(self.repo / 'legacy' / 'old.go', 'package legacy\n')
        base = self.git('rev-parse', 'HEAD^')
        # A passing run for the baseline commit first.
        self.call('check', '--base', base, ok=True)
        contract = {
            'schema': 'dairn.refactor.v1', 'id': 'retire-legacy', 'intent': 'behavior-preserving',
            'baseline': {'source_commit': base, 'contracts': ['contract']},
            'target': {'properties': ['legacy-removed']},
            'migration': {'strategy': 'incremental',
                          'exit_conditions': ['no-new-failures-beyond-baseline', 'no-legacy-callers']},
            'debt': {'allowed_transitional_items': [], 'known_failures': []},
            'paths': ['legacy/']}
        contract_file = self.repo / 'contract.json'
        contract_file.write_text(json.dumps(contract))
        plan = self.obj('refactor', 'plan', '--id', 'retire-legacy', '--file', 'contract.json')
        self.assertFalse(plan['applied'])
        self.assertFalse((self.repo / '.dairn/governance/refactors/retire-legacy.json').exists())
        applied = self.obj('refactor', 'plan', '--id', 'retire-legacy', '--file', 'contract.json', '--apply')
        self.assertTrue(applied['applied'])
        status = self.obj('refactor', 'status', '--id', 'retire-legacy')
        self.assertEqual(status['id'], 'retire-legacy')
        # The planner now appends the contract's requirement for matching paths.
        head = self.commit_change(self.repo / 'legacy' / 'new.go', 'package legacy\n')
        base2 = self.git('rev-parse', 'HEAD^')
        plan2 = self.obj('governance', 'plan', '--base', base2)['plan']
        self.assertTrue(any(r['origin'] == 'approved-refactor-contract:retire-legacy'
                            for r in plan2['requirements']))
        # compare/verify consume the locally recorded run evidence.
        compare = self.call('refactor', 'compare', '--id', 'retire-legacy')
        self.assertEqual(compare.returncode, 0, compare.stdout + compare.stderr)
        verify = self.call('refactor', 'verify', '--id', 'retire-legacy')
        # no-legacy-callers cannot be established locally: needs-review (exit 3)
        self.assertEqual(verify.returncode, 3, verify.stdout + verify.stderr)
        self.assertIn('needs-review', verify.stdout)

    def test_adopt_discover_plan_is_readonly_with_findings(self):
        repo = Path(self.tmp.name) / 'existing'
        repo.mkdir()
        (repo / 'go.mod').write_text('module example.com/x\n\ngo 1.20\n')
        (repo / '.github' / 'workflows').mkdir(parents=True)
        (repo / '.github' / 'workflows' / 'ci.yml').write_text('name: ci\n')
        proc = subprocess.run([str(CLI), 'adopt', '--path', repo, '--stack', 'go', '--discover', '--plan'],
                              capture_output=True, text=True, timeout=180)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        out = json.loads(proc.stdout)
        self.assertIn('discovery', out)
        self.assertEqual(out['discovery']['repository']['ci'][0]['name'], 'github-actions')
        self.assertTrue(any(s['stack'] == 'go' for s in out['discovery']['repository']['stacks']))
        self.assertFalse((repo / '.dairn' / 'lock.json').exists(), 'plan mode must not write')


if __name__ == '__main__':
    unittest.main()
