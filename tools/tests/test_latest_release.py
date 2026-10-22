"""离线验证 latest 别名、滚动发布顺序和防回退行为。"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release_config import artifact_names
spec = importlib.util.spec_from_file_location('publish_latest_tests', Path(__file__).resolve().parents[1] / 'publish-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class LatestReleaseTests(unittest.TestCase):
    def setUp(self):
        quiet = patch('builtins.print')
        quiet.start()
        self.addCleanup(quiet.stop)
        temp = tempfile.TemporaryDirectory(prefix='dairn-latest-test-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.artifacts = self.root / 'versioned'
        self.artifacts.mkdir()
        self.latest = self.root / 'latest'
        self.config = {'name': 'dairn', 'python_name': 'dairn', 'version': '2.3.4-rc.5'}
        self.names = artifact_names(self.config)
        for name in self.names.values():
            (self.artifacts / name).write_bytes(name.encode())
        checksums = {'artifacts': {name: release.sha(self.artifacts / name) for name in self.names.values()}, 'ape_sha256': 'e' * 64}
        (self.artifacts / 'checksums.json').write_text(json.dumps(checksums), encoding='utf-8')
        self.commit = 'a' * 40
        self.repo = 'example/dairn'
        self.versioned = release.plan_release(self.artifacts, self.config, self.commit)
        self.plan = release.prepare_latest(self.versioned, self.artifacts, self.repo, self.latest)
        self.ref = {'object': {'type': 'commit', 'sha': self.commit}}
        self.old_ref = {'object': {'type': 'commit', 'sha': 'b' * 40}}

    def existing(self, draft=False, names=None):
        return {'draft': draft, 'assets': [{'name': name} for name in (names or self.plan['files'])]}

    def test_aliases_preserve_verified_bytes_and_wheel_filename(self):
        self.assertEqual(set(self.plan['files']), {'dairn-latest.tgz', 'dairn-latest.zip', self.names['wheel'], 'wheels.html', 'checksums.json'})
        for kind, alias in [('npm', 'dairn-latest.tgz'), ('zip', 'dairn-latest.zip'), ('wheel', self.names['wheel'])]:
            self.assertEqual((self.latest / alias).read_bytes(), (self.artifacts / self.names[kind]).read_bytes())
        index = (self.latest / 'wheels.html').read_text(encoding='utf-8')
        self.assertIn(f'/releases/download/{self.versioned["tag"]}/{self.names["wheel"]}#sha256=', index)
        checksums = json.loads((self.latest / 'checksums.json').read_text())
        self.assertEqual(checksums['version'], self.config['version'])
        self.assertEqual(checksums['ape_sha256'], 'e' * 64)
        self.assertEqual(checksums['commit'], self.commit)
        self.assertTrue(self.plan['prerelease'])

    def test_create_upload_tag_then_publish(self):
        with patch.object(release, 'api', side_effect=[None, None, [], None]), patch.object(release, 'gh') as gh:
            release.publish_latest(self.plan, self.latest, self.repo)
        calls = [call.args for call in gh.call_args_list]
        self.assertEqual([c[:2] for c in calls], [('release', 'create'), ('release', 'upload'), ('api', '--method'), ('release', 'edit')])
        self.assertIn('--draft', calls[0])
        self.assertIn('POST', calls[2])
        self.assertIn('ref=refs/tags/latest', calls[2])
        self.assertIn('--prerelease=true', calls[3])
        self.assertIn('--draft=false', calls[3])

    def test_update_removes_old_wheel_only_after_upload(self):
        old_wheel = 'dairn-2.3.3-py3-none-any.whl'
        names = set(self.plan['files']) - {self.names['wheel']} | {old_wheel}
        with patch.object(release, 'api', side_effect=[self.old_ref, self.existing(names=names), {'status': 'ahead'}, self.old_ref]), patch.object(release, 'gh') as gh:
            release.publish_latest(self.plan, self.latest, self.repo)
        calls = [call.args for call in gh.call_args_list]
        self.assertIn('--draft=true', calls[0])
        self.assertEqual(calls[1][:2], ('release', 'upload'))
        self.assertEqual(calls[2][:4], ('release', 'delete-asset', 'latest', old_wheel))
        self.assertIn('PATCH', calls[3])
        self.assertIn('sha=' + self.commit, calls[3])
        self.assertIn('--draft=false', calls[4])

    def test_failed_upload_leaves_draft_and_does_not_move_tag(self):
        with patch.object(release, 'api', side_effect=[self.old_ref, self.existing(), {'status': 'ahead'}]), patch.object(release, 'gh') as gh:
            gh.side_effect = [None, subprocess.CalledProcessError(1, 'upload')]
            with self.assertRaises(subprocess.CalledProcessError):
                release.publish_latest(self.plan, self.latest, self.repo)
        self.assertEqual([c.args[:2] for c in gh.call_args_list], [('release', 'edit'), ('release', 'upload')])

    def test_identical_latest_is_read_only(self):
        def download(*args):
            destination = args[args.index('--dir') + 1]
            for path in self.latest.iterdir():
                shutil.copyfile(path, destination / path.name)
        with patch.object(release, 'api', side_effect=[self.ref, self.existing()]), patch.object(release, 'gh', side_effect=download) as gh:
            release.publish_latest(self.plan, self.latest, self.repo)
        self.assertEqual(gh.call_count, 1)
        self.assertEqual(gh.call_args.args[:2], ('release', 'download'))

    def test_older_run_does_not_roll_back_latest(self):
        with patch.object(release, 'api', side_effect=[self.old_ref, self.existing(), {'status': 'behind'}]), patch.object(release, 'gh') as gh:
            release.publish_latest(self.plan, self.latest, self.repo)
        gh.assert_not_called()

    def test_diverged_history_is_rejected(self):
        with patch.object(release, 'api', side_effect=[self.old_ref, self.existing(), {'status': 'diverged'}]), patch.object(release, 'gh') as gh:
            with self.assertRaisesRegex(ValueError, '前进历史'):
                release.publish_latest(self.plan, self.latest, self.repo)
        gh.assert_not_called()

    def test_unknown_assets_are_not_deleted(self):
        names = set(self.plan['files']) | {'manual-notes.txt'}
        with patch.object(release, 'api', side_effect=[self.ref, self.existing(names=names)]), patch.object(release, 'gh') as gh:
            with self.assertRaisesRegex(ValueError, '非托管附件'):
                release.publish_latest(self.plan, self.latest, self.repo)
        gh.assert_not_called()

    def test_draft_resume_can_create_missing_tag(self):
        with patch.object(release, 'api', side_effect=[None, self.existing(draft=True), None]), patch.object(release, 'gh') as gh:
            release.publish_latest(self.plan, self.latest, self.repo)
        self.assertEqual([c.args[:2] for c in gh.call_args_list], [('release', 'upload'), ('api', '--method'), ('release', 'edit')])

    def test_tag_race_stops_before_overwriting_other_commit(self):
        changed = {'object': {'type': 'commit', 'sha': 'c' * 40}}
        with patch.object(release, 'api', side_effect=[self.old_ref, self.existing(), {'status': 'ahead'}, changed]), patch.object(release, 'gh') as gh:
            with self.assertRaisesRegex(ValueError, '发布过程中发生变化'):
                release.publish_latest(self.plan, self.latest, self.repo)
        self.assertEqual([c.args[:2] for c in gh.call_args_list], [('release', 'edit'), ('release', 'upload')])

    def test_versioned_failure_prevents_latest_publication(self):
        argv = ['publish-release.py', '--artifacts', str(self.artifacts), '--repo', self.repo, '--commit', self.commit]
        env = {'GITHUB_REF_TYPE': 'tag', 'GITHUB_REF_NAME': 'v' + self.config['version']}
        with patch.object(sys, 'argv', argv), patch.dict(os.environ, env), \
                patch.object(release, 'load_release', return_value=self.config), \
                patch.object(release, 'publish', side_effect=ValueError('版本发布失败')), patch.object(release, 'publish_latest') as latest:
            with self.assertRaisesRegex(ValueError, '版本发布失败'):
                release.main()
        latest.assert_not_called()


if __name__ == '__main__':
    unittest.main()
