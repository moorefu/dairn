"""PCC 必需项与 SCM 来源故障注入；模拟 API 只验证组件，不能替代真实试点。"""
import copy
import importlib.util
from pathlib import Path
import unittest

_spec = importlib.util.spec_from_file_location('pcc_gate', Path(__file__).resolve().parents[2] / 'ci/protected/pcc-gate.py')
pcc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pcc)


class SCM:
    def __init__(self, envelope):
        self.head, self.base = 'a' * 40, 'b' * 40
        self.protected = True
        self.reviews = [{'id': 1, 'user': {'login': 'reviewer', 'type': 'User'},
                         'state': 'APPROVED', 'commit_id': self.head}]
        self.permissions = {'reviewer': 'write'}
        self.checks = [{'id': 100, 'name': '独立单测', 'head_sha': self.head, 'status': 'completed',
                        'conclusion': 'success', 'app': {'id': 900001},
                        'external_id': 'pcc:' + envelope['plan_sha256'] + ':' + pcc.digest('app.unit') + ':' + self.head}]

    def get(self, path):
        if '/branches/' in path:
            return {'protected': self.protected}
        if '/git/commits/' in path:
            return {'tree': {'sha': 'c' * 40}}
        if '/collaborators/' in path:
            login = path.split('/collaborators/', 1)[1].split('/', 1)[0]
            return {'permission': self.permissions.get(login, 'read')}
        return {'state': 'open', 'head': {'sha': self.head}, 'base': {'sha': self.base, 'ref': 'main'},
                'user': {'login': 'author'}}

    def pages(self, path, key=None):
        return self.checks if key else self.reviews


class PCCGate(unittest.TestCase):
    def setUp(self):
        plan = {'subject': {'repository': 'org/repo', 'source_commit': 'a' * 40, 'tree_sha': 'c' * 40,
                           'base_commit': 'b' * 40, 'change': {'number': 1}, 'stage': 'pre-merge'},
                'requirements': [{'id': 'app.unit', 'required': True}], 'executors':[{'requirement_id':'app.unit','argv':['python','-m','unittest']}], 'gaps': [],
                'approvals': [{'required': True, 'min_count': 1}]}
        self.envelope = {'plan': plan, 'plan_sha256': pcc.digest('dairn.governance-plan.v1\n' + pcc.canonical(plan))}
        self.admin = {'requirements': {'app.unit': {'app_id': 900001, 'check_name': '独立单测'}}}
        self.scm = SCM(self.envelope)

    def verdict(self):
        return pcc.evaluate(self.scm, 'org/repo', 1, self.envelope, self.admin)['status']

    def bind_plan(self):
        self.envelope['plan_sha256'] = pcc.digest('dairn.governance-plan.v1\n' + pcc.canonical(self.envelope['plan']))
        self.scm.checks[0]['external_id'] = ('pcc:' + self.envelope['plan_sha256'] + ':'
                                             + pcc.digest('app.unit') + ':' + self.scm.head)

    def test_positive_authenticated_component(self):
        self.assertEqual(self.verdict(), 'PASS')

    def test_faults_never_wrong_pass(self):
        cases = [
            lambda: setattr(self.scm, 'protected', False),
            lambda: setattr(self.scm, 'checks', []),
            lambda: self.scm.checks[0].update(status='in_progress'),
            lambda: self.scm.checks[0].update(conclusion='failure'),
            lambda: self.scm.checks[0].update(conclusion='timed_out'),
            lambda: self.scm.checks[0].update(conclusion='skipped'),
            lambda: self.scm.checks[0].update(head_sha='d' * 40),
            lambda: self.scm.checks[0].update(external_id='forged'),
            lambda: self.scm.checks[0].update(app={'id': 15368}),
            lambda: self.scm.reviews[0].update(commit_id='d' * 40),
            lambda: self.scm.reviews[0].update(state='DISMISSED'),
            lambda: self.scm.reviews[0].update(user={'login': 'author', 'type': 'User'}),
            lambda: self.scm.reviews[0].update(user={'login': 'bot', 'type': 'Bot'}),
            lambda: self.admin['requirements'].clear(),
            lambda: self.envelope['plan'].update(gaps=[{'kind': 'REQUIRED_EXECUTOR_MISSING'}]),
        ]
        for index, inject in enumerate(cases):
            self.setUp()
            inject()
            with self.subTest(fault=index):
                self.assertNotEqual(self.verdict(), 'PASS')

    def test_latest_failure_cannot_be_overridden_by_old_success(self):
        newest = copy.deepcopy(self.scm.checks[0])
        newest.update(id=101, conclusion='failure')
        self.scm.checks.append(newest)
        self.assertEqual(self.verdict(), 'FAIL')

    def test_required_approval_cannot_have_zero_effective_count(self):
        self.envelope['plan']['approvals'][0]['min_count'] = 0
        self.bind_plan()
        self.scm.reviews = []
        self.assertEqual(self.verdict(), 'INDETERMINATE')

    def test_only_eligible_reviewer_can_block_with_changes_requested(self):
        self.scm.reviews.append({'id': 2, 'user': {'login': 'external-reader', 'type': 'User'},
                                 'state': 'CHANGES_REQUESTED', 'commit_id': self.scm.head})
        self.assertEqual(self.verdict(), 'PASS')
        self.scm.permissions['external-reader'] = 'write'
        self.assertEqual(self.verdict(), 'FAIL')

    def test_duplicate_requirement_or_executor_is_not_shared_coverage(self):
        for field in ('requirements', 'executors'):
            self.setUp()
            self.envelope['plan'][field].append(copy.deepcopy(self.envelope['plan'][field][0]))
            self.bind_plan()
            result = pcc.evaluate(self.scm, 'org/repo', 1, self.envelope, self.admin)
            with self.subTest(field=field):
                self.assertEqual(result['status'], 'FAIL')
                self.assertIn('REQUIREMENT_ID_CONFLICT', str(result))

    def test_plan_tampering_is_rejected(self):
        self.envelope['plan']['requirements'][0]['id'] = 'weakened'
        self.assertEqual(self.verdict(), 'FAIL')

    def test_empty_requirement_set_is_not_vacuous_pass(self):
        self.envelope['plan']['requirements'] = []
        self.envelope['plan_sha256'] = pcc.digest('dairn.governance-plan.v1\n' + pcc.canonical(self.envelope['plan']))
        self.assertNotEqual(self.verdict(), 'PASS')
