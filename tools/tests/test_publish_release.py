"""离线验证发布门禁和重跑行为，不访问或修改 GitHub。"""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release_config import artifact_names
spec = importlib.util.spec_from_file_location('publish_release', Path(__file__).resolve().parents[1] / 'publish-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class PublishReleaseTests(unittest.TestCase):
    def setUp(self):
        self.quiet = patch('builtins.print')
        self.quiet.start()
        self.addCleanup(self.quiet.stop)
        self.temp = tempfile.TemporaryDirectory(prefix='dairn-release-test-')
        self.addCleanup(self.temp.cleanup)
        self.artifacts = Path(self.temp.name)
        self.config = {'name': 'dairn', 'python_name': 'dairn', 'version': '2.3.4-rc.5'}
        self.commit = 'a' * 40
        self.repo = 'example/dairn'
        self.names = artifact_names(self.config)
        for name in self.names.values():
            (self.artifacts / name).write_bytes(name.encode())
        hashes = {name: release.sha(self.artifacts / name) for name in self.names.values()}
        (self.artifacts / 'checksums.json').write_text(json.dumps({'artifacts': hashes}), encoding='utf-8')
        self.plan = release.plan_release(self.artifacts, self.config, self.commit)
        self.ref = {'object': {'type': 'commit', 'sha': self.commit}}

    def test_rc_plan_has_exactly_three_packages_and_checksums(self):
        self.assertEqual(self.plan['tag'], 'v' + self.config['version'])
        self.assertTrue(self.plan['prerelease'])
        self.assertEqual(set(self.plan['files']), {p.name for p in self.artifacts.iterdir()})
        self.assertEqual(len(self.plan['files']), 4)

    def test_corrupt_package_blocks_publish_plan(self):
        (self.artifacts / self.names['zip']).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, '校验失败'):
            release.plan_release(self.artifacts, self.config, self.commit)

    def test_unexpected_file_blocks_publish_plan(self):
        (self.artifacts / 'source.tar.gz').write_bytes(b'source')
        with self.assertRaisesRegex(ValueError, '必须且只能'):
            release.plan_release(self.artifacts, self.config, self.commit)

    def test_tag_version_must_match(self):
        with self.assertRaisesRegex(ValueError, '触发标签'):
            release.plan_release(self.artifacts, self.config, self.commit, 'tag', 'v1.0.0')

    def test_invalid_version_blocks_publish_plan(self):
        with self.assertRaisesRegex(ValueError, '发布版本'):
            release.plan_release(self.artifacts, {**self.config, 'version': '2.3.4rc5'}, self.commit)

    def test_create_upload_then_publish(self):
        with patch.object(release, 'api', side_effect=[None, None, []]), patch.object(release, 'gh') as gh:
            release.publish(self.plan, self.artifacts, self.repo)
        calls = [call.args for call in gh.call_args_list]
        self.assertEqual([args[1] for args in calls], ['create', 'upload', 'edit'])
        self.assertIn('--draft', calls[0])
        self.assertEqual(calls[0][calls[0].index('--target') + 1], self.commit)
        self.assertEqual(set(calls[1][3:7]), {self.artifacts / name for name in self.plan['files']})
        self.assertIn('--draft=false', calls[2])
        self.assertIn('--prerelease=true', calls[2])
        self.assertIn('--latest=false', calls[2])

    def test_failed_upload_leaves_release_in_draft(self):
        with patch.object(release, 'api', side_effect=[None, None, []]), patch.object(release, 'gh') as gh:
            gh.side_effect = [None, subprocess.CalledProcessError(1, 'gh release upload')]
            with self.assertRaises(subprocess.CalledProcessError):
                release.publish(self.plan, self.artifacts, self.repo)
        self.assertEqual([call.args[1] for call in gh.call_args_list], ['create', 'upload'])

    def test_existing_tag_at_other_commit_is_never_changed(self):
        other_ref = {'object': {'type': 'commit', 'sha': 'b' * 40}}
        with patch.object(release, 'api', return_value=other_ref), patch.object(release, 'gh') as gh:
            with self.assertRaisesRegex(ValueError, '其他提交'):
                release.publish(self.plan, self.artifacts, self.repo)
            gh.assert_not_called()

    def test_annotated_tag_is_resolved_before_resume(self):
        tagged = {'object': {'type': 'tag', 'sha': 'c' * 40}}
        draft = {'draft': True, 'assets': []}
        with patch.object(release, 'api', side_effect=[tagged, self.ref, draft]), patch.object(release, 'gh') as gh:
            release.publish(self.plan, self.artifacts, self.repo)
        self.assertEqual([call.args[1] for call in gh.call_args_list], ['upload', 'edit'])

    def test_resume_draft_found_only_in_release_list(self):
        draft = {'draft': True, 'assets': [], 'tag_name': self.plan['tag'], 'target_commitish': self.commit}
        with patch.object(release, 'api', side_effect=[None, None, [draft]]), patch.object(release, 'gh') as gh:
            release.publish(self.plan, self.artifacts, self.repo)
        self.assertEqual([call.args[1] for call in gh.call_args_list], ['upload', 'edit'])

    def test_stable_release_is_latest(self):
        plan = {**self.plan, 'prerelease': False}
        with patch.object(release, 'api', side_effect=[None, None, []]), patch.object(release, 'gh') as gh:
            release.publish(plan, self.artifacts, self.repo)
        self.assertIn('--prerelease=false', gh.call_args_list[-1].args)
        self.assertIn('--latest=true', gh.call_args_list[-1].args)

    def existing_release(self):
        return {'draft': False, 'assets': [{'name': name} for name in self.plan['files']]}

    def download(self, *args):
        self.assertEqual(args[:2], ('release', 'download'))
        destination = args[args.index('--dir') + 1]
        for path in self.artifacts.iterdir():
            shutil.copyfile(path, destination / path.name)

    def test_identical_published_release_is_read_only(self):
        with patch.object(release, 'api', side_effect=[self.ref, self.existing_release()]), patch.object(release, 'gh', side_effect=self.download) as gh:
            release.publish(self.plan, self.artifacts, self.repo)
        self.assertEqual(gh.call_count, 1)

    def test_different_published_bytes_are_not_overwritten(self):
        def download_corrupt(*args):
            self.download(*args)
            destination = args[args.index('--dir') + 1]
            (destination / self.names['zip']).write_bytes(b'old release')
        with patch.object(release, 'api', side_effect=[self.ref, self.existing_release()]), patch.object(release, 'gh', side_effect=download_corrupt) as gh:
            with self.assertRaisesRegex(ValueError, '不同制品'):
                release.publish(self.plan, self.artifacts, self.repo)
        self.assertEqual(gh.call_count, 1)


if __name__ == '__main__':
    unittest.main()
