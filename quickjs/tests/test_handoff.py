"""dairn handoff end-to-end: read-only, zero-write, works in plain git repos.

Covers the HND acceptance matrix that needs a real git repository (the pure
semantics live in test_handoff_native.mjs). Runs the real launcher against a
temporary repository; never touches the network.
"""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / 'dairn'


class HandoffE2E(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='dairn-handoff-')
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name) / 'repo'
        self.repo.mkdir()
        self.git('init', '-q', '--initial-branch', 'main')
        self.git('config', 'user.name', 'Tester')
        self.git('config', 'user.email', 'tester@example.test')
        (self.repo / 'README.md').write_text('hello\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'baseline')
        self.baseline = self.git('rev-parse', 'HEAD')

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.repo, capture_output=True, text=True, check=True).stdout.strip()

    def call(self, *args, env=None):
        return subprocess.run([str(CLI), *map(str, args), '--root', self.repo],
                              capture_output=True, text=True, timeout=120,
                              env={**os.environ, **(env or {})})

    def obj(self, *args):
        result = self.call(*args, '--json')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def status_before(self):
        return self.git('status', '--porcelain=v1', '--untracked-files=all')

    def test_hnd01_plain_git_repo_no_dairn(self):
        view = self.obj('handoff')
        self.assertEqual(view['schema'], 'dairn.handoff.v1')
        self.assertEqual(view['repository']['head_sha'], self.git('rev-parse', 'HEAD'))
        self.assertEqual(view['references']['tasks'], [])

    def test_hnd09_default_run_is_read_only_zero_writes(self):
        (self.repo / 'dirty.txt').write_text('x\n')
        before = self.status_before()
        result = self.call('handoff')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('# Agent Handoff', result.stdout)
        self.assertEqual(self.status_before(), before, 'handoff mutated the worktree')
        self.assertFalse((self.repo / '.dairn').exists(), 'handoff created .dairn')

    def test_hnd02_staged_unstaged_untracked_and_note(self):
        (self.repo / 'src.txt').write_text('one\n')
        self.git('add', 'src.txt')
        (self.repo / 'src.txt').write_text('two\n')
        (self.repo / '新 文件.txt').write_text('三\n')
        view = self.obj('handoff', '--note', 'next: fix the flaky test')
        self.assertEqual([x['path'] for x in view['workspace']['staged']], ['src.txt'])
        self.assertEqual([x['path'] for x in view['workspace']['unstaged']], ['src.txt'])
        self.assertEqual(view['workspace']['untracked'], ['新 文件.txt'])
        self.assertEqual(view['note']['trust'], 'user-supplied/advisory')
        self.assertIn('新 文件.txt', self.call('handoff').stdout)

    def test_hnd03_base_equals_head_shows_recent_window(self):
        view = self.obj('handoff', '--base', 'main')
        self.assertEqual(view['repository']['base_sha'], self.baseline)
        self.assertEqual(view['activity']['range'], 'recent-commits')
        self.assertTrue(any('equals the resolved base' in x for x in view['limitations']))

    def test_hnd04_detached_and_unknown_base(self):
        self.git('checkout', '-q', '--detach', 'HEAD')
        view = self.obj('handoff')
        self.assertTrue(view['repository']['detached'])
        bad = self.call('handoff', '--base', 'no-such-ref')
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn('--base', bad.stdout + bad.stderr)

    def test_hnd05_rename_and_since_base_changes(self):
        (self.repo / 'src').mkdir()
        (self.repo / 'src' / 'a.go').write_text('package a\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'add a.go')
        base = self.git('rev-parse', 'HEAD')
        self.git('mv', 'src/a.go', 'src/b.go')
        self.git('commit', '-qm', 'rename a.go to b.go')
        view = self.obj('handoff', '--base', base)
        self.assertEqual(view['activity']['range'], 'since-base')
        renames = [c for c in view['activity']['changes'] if c['status'] == 'R']
        self.assertEqual(len(renames), 1)
        self.assertEqual((renames[0]['path'], renames[0]['from']), ('src/b.go', 'src/a.go'))
        self.assertEqual(len(view['activity']['commits']), 1)

    def test_hnd06_local_evidence_and_task_references(self):
        head = self.git('rev-parse', 'HEAD')
        run_dir = self.repo / '.dairn' / 'governance' / 'evidence' / 'runs' / head / 'run-local-0001'
        run_dir.mkdir(parents=True)
        (run_dir / 'run.json').write_text(json.dumps({'schema': 'dairn.check-run.v1',
            'run_id': 'run-local-0001', 'status': 'passed', 'declared_assurance': 'local-observed'}))
        view = self.obj('handoff')
        self.assertEqual([x['run_id'] for x in view['verification']['local_observed']], ['run-local-0001'])
        self.assertNotIn('ci-verified', json.dumps(view['verification']))
        # A failing run for this HEAD surfaces as an evidence-backed blocker.
        (run_dir / 'run.json').write_text(json.dumps({'schema': 'dairn.check-run.v1',
            'run_id': 'run-local-0001', 'status': 'failed', 'declared_assurance': 'local-observed'}))
        failed = self.obj('handoff')
        self.assertTrue(failed['blockers'], 'failing local run not surfaced')

    def test_hnd07_broken_work_ledger_degrades(self):
        (self.repo / '.dairn' / 'work').mkdir(parents=True)
        (self.repo / '.dairn' / 'work' / 'auth.json').write_text('{broken')
        view = self.obj('handoff', '--task', 'auth')
        self.assertEqual(view['repository']['head_sha'], self.git('rev-parse', 'HEAD'))
        self.assertEqual(view['references']['tasks'][0]['status'], 'unreadable')
        self.assertTrue(any('unreadable' in x for x in view['limitations']))

    def test_hnd09b_explicit_out_is_atomic_and_refuses_overwrite(self):
        (self.repo / 'dirty.txt').write_text('x\n')
        result = self.call('handoff', '--out', '.dairn/tmp/handoff.md')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        written = self.repo / '.dairn' / 'tmp' / 'handoff.md'
        self.assertTrue(written.is_file())
        self.assertIn('# Agent Handoff', written.read_text(encoding='utf-8'))
        again = self.call('handoff', '--out', '.dairn/tmp/handoff.md')
        self.assertNotEqual(again.returncode, 0, 'overwrote existing handoff output')
        escaped = self.call('handoff', '--out', '../escape.md')
        self.assertNotEqual(escaped.returncode, 0, 'escaped the project root')

    def test_hnd10_max_chars_budget(self):
        for i in range(30):
            (self.repo / f'file{i:02}.txt').write_text(f'content {i}\n')
            self.git('add', f'file{i:02}.txt')
        self.git('commit', '-qm', 'add many files')
        result = self.call('handoff', '--base', self.baseline, '--max-chars', '1500')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertLessEqual(len(result.stdout), 2200)
        self.assertIn('truncated', result.stdout)

    def test_hnd11_fingerprint_tracks_workspace_changes(self):
        first = self.obj('handoff')
        (self.repo / 'note.txt').write_text('v1\n')
        second = self.obj('handoff')
        self.assertNotEqual(first['workspace']['handoff_fingerprint_sha256'],
                            second['workspace']['handoff_fingerprint_sha256'])
        (self.repo / 'note.txt').write_text('v2 different\n')
        third = self.obj('handoff')
        self.assertNotEqual(second['workspace']['handoff_fingerprint_sha256'],
                            third['workspace']['handoff_fingerprint_sha256'])

    def test_hnd15_output_is_harness_neutral(self):
        text = self.call('handoff').stdout
        for banned in ['claude', 'codex', 'deepseek', '<system']:
            self.assertNotIn(banned, text.lower())


if __name__ == '__main__':
    unittest.main()
