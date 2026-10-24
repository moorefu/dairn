"""验证跨生态版本转换和标签优先的版本入口。"""
import json
from datetime import datetime, timezone
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release_config import artifact_names, load_release, nightly_version, npm_filename, tag_version, version_info


class ReleaseConfigTests(unittest.TestCase):
    def test_semver_to_python_version(self):
        cases = [('2.3.4', '2.3.4', False), ('2.3.4-alpha.0', '2.3.4a0', True),
                 ('2.3.4-beta.12', '2.3.4b12', True), ('2.3.4-rc.5', '2.3.4rc5', True),
                 ('2.3.4-nightly.20261024010203', '2.3.4.dev20261024010203', True)]
        for version, python_version, prerelease in cases:
            with self.subTest(version=version):
                self.assertEqual(version_info(version), {
                    'version': version, 'python_version': python_version, 'prerelease': prerelease})

    def test_invalid_versions_are_rejected(self):
        for version in ['v2.3.4', '2.3', '02.3.4', '2.3.4rc5', '2.3.4-rc.05', '2.3.4+local',
                        '2.3.4-nightly.1', '2.3.4-nightly.202610240102030']:
            with self.subTest(version=version), self.assertRaises(ValueError):
                version_info(version)

    def test_nightly_uses_beijing_time_and_replaces_previous_suffix(self):
        instant = datetime(2026, 10, 23, 17, 2, 3, tzinfo=timezone.utc)
        for current in ['2.3.4', '2.3.4-rc.5', '2.3.4-nightly.20261023000000']:
            with self.subTest(current=current):
                self.assertEqual(nightly_version(current, instant), '2.3.4-nightly.20261024010203')

    def test_nightly_artifact_versions_are_consistent(self):
        version = '2.3.4-nightly.20261024010203'
        with tempfile.TemporaryDirectory(prefix='dairn-nightly-') as temp:
            root = self.release_root(temp, version=version)
            with patch.dict(os.environ, {}, clear=True):
                release = load_release(root)
            self.assertEqual(tag_version('v' + version), version)
            self.assertEqual(artifact_names(release), {
                'npm': 'dairn-' + version + '.tgz',
                'wheel': 'dairn-2.3.4.dev20261024010203-py3-none-any.whl',
                'zip': 'dairn-' + version + '.zip'})

    def test_tag_version_accepts_v_prefix_only(self):
        self.assertEqual(tag_version('v2.3.4-rc.5'), '2.3.4-rc.5')
        self.assertEqual(tag_version('2.3.4'), '2.3.4')
        for name in ['release-2.3.4', 'v2.3', 'v2.3.4rc5']:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, '不是有效的发布版本'):
                tag_version(name)

    def release_root(self, temp, version='2.3.4', npm_name='dairn'):
        root = Path(temp)
        (root / 'tools').mkdir()
        (root / 'tools/release.json').write_text(
            json.dumps({'name': 'dairn', 'python_name': 'dairn'}), encoding='utf-8')
        (root / 'package.json').write_text(
            json.dumps({'name': npm_name, 'version': version}), encoding='utf-8')
        return root

    def test_scoped_npm_name_drives_tarball_filename(self):
        self.assertEqual(npm_filename('@moorefu/dairn'), 'moorefu-dairn')
        with tempfile.TemporaryDirectory(prefix='dairn-version-') as temp:
            root = self.release_root(temp, npm_name='@moorefu/dairn')
            with patch.dict(os.environ, {'DAIRN_VERSION': 'v0.1.0-rc.2'}, clear=True):
                release = load_release(root)
            self.assertEqual(release['npm_name'], '@moorefu/dairn')
            self.assertEqual(artifact_names(release), {
                'npm': 'moorefu-dairn-0.1.0-rc.2.tgz',
                'wheel': 'dairn-0.1.0rc2-py3-none-any.whl',
                'zip': 'dairn-0.1.0-rc.2.zip'})

    def test_tag_version_overrides_package_json(self):
        with tempfile.TemporaryDirectory(prefix='dairn-version-') as temp:
            root = self.release_root(temp)
            with patch.dict(os.environ, {'DAIRN_VERSION': 'v9.1.2-rc.3'}, clear=True):
                release = load_release(root)
            self.assertEqual(release['version'], '9.1.2-rc.3')
            self.assertEqual(release['python_version'], '9.1.2rc3')
            self.assertEqual(artifact_names(release), {
                'npm': 'dairn-9.1.2-rc.3.tgz',
                'wheel': 'dairn-9.1.2rc3-py3-none-any.whl',
                'zip': 'dairn-9.1.2-rc.3.zip'})
            env = {'GITHUB_REF_TYPE': 'tag', 'GITHUB_REF_NAME': 'v7.8.9'}
            with patch.dict(os.environ, env, clear=True):
                self.assertEqual(load_release(root)['version'], '7.8.9')
            with patch.dict(os.environ, {'GITHUB_REF_TYPE': 'branch', 'GITHUB_REF_NAME': 'main'}, clear=True):
                self.assertEqual(load_release(root)['version'], '2.3.4')
            with patch.dict(os.environ, {'DAIRN_VERSION': '1.2'}, clear=True):
                with self.assertRaisesRegex(ValueError, '不是有效的发布版本'):
                    load_release(root)

    def test_package_json_is_the_fallback_version(self):
        with tempfile.TemporaryDirectory(prefix='dairn-version-') as temp:
            root = Path(temp)
            (root / 'tools').mkdir()
            config = {'name': 'dairn', 'python_name': 'dairn'}
            (root / 'tools/release.json').write_text(json.dumps(config), encoding='utf-8')
            for version, wheel_version in [('2.3.4-rc.5', '2.3.4rc5'), ('3.0.0', '3.0.0')]:
                (root / 'package.json').write_text(json.dumps({'name': 'dairn', 'version': version}), encoding='utf-8')
                with patch.dict(os.environ, {}, clear=True):
                    release = load_release(root)
                self.assertEqual(artifact_names(release), {
                    'npm': f'dairn-{version}.tgz', 'wheel': f'dairn-{wheel_version}-py3-none-any.whl',
                    'zip': f'dairn-{version}.zip'})
            for field in ('version', 'python_version', 'npm_version'):
                (root / 'tools/release.json').write_text(json.dumps({**config, field: '3.0.0'}), encoding='utf-8')
                with patch.dict(os.environ, {}, clear=True), \
                        self.assertRaisesRegex(ValueError, '标签或 package.json'):
                    load_release(root)


if __name__ == '__main__':
    unittest.main()
