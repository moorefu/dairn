"""验证跨生态版本转换、标签优先和构建时间 nightly 入口。"""
import json
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release_config import (artifact_names, build_instant, format_instant, load_release, nightly_version,
                            npm_filename, tag_version, version_from_archive, version_from_artifacts,
                            version_info)

BEIJING = timezone(timedelta(hours=8))
STAMP = '2026-10-23T17:02:03Z'  # 北京时间 2026-10-24 01:02:03
NIGHTLY = '2.3.4-nightly.20261024010203'


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
                self.assertEqual(nightly_version(current, instant), NIGHTLY)

    def test_build_instant_accepts_epoch_and_iso(self):
        instant = datetime(2026, 10, 22, 8, 0, 0, tzinfo=BEIJING)
        cases = [(str(int(instant.timestamp())), '2026-10-22T08:00:00+08:00'),
                 ('2026-10-22T00:00:00Z', '2026-10-22T08:00:00+08:00'),
                 ('2026-10-22T08:00:00+08:00', '2026-10-22T08:00:00+08:00'),
                 ('2026-10-22T08:00:00', '2026-10-22T08:00:00+08:00')]
        for raw, expected in cases:
            with self.subTest(raw=raw), patch.dict(os.environ, {'DAIRN_BUILD_TIME': raw}, clear=True):
                self.assertEqual(format_instant(build_instant()), expected)
        with patch.dict(os.environ, {'DAIRN_BUILD_TIME': 'not-a-time'}, clear=True), \
                self.assertRaisesRegex(ValueError, '不是有效时间'):
            build_instant()

    def test_nightly_version_uses_build_time_environment(self):
        with patch.dict(os.environ, {'DAIRN_BUILD_TIME': STAMP}, clear=True):
            for base in ['2.3.4', '2.3.4-rc.5', '2.3.4-nightly.20261023000000']:
                with self.subTest(base=base):
                    self.assertEqual(nightly_version(base), NIGHTLY)

    def test_nightly_artifact_versions_are_consistent(self):
        with tempfile.TemporaryDirectory(prefix='dairn-nightly-') as temp:
            root = self.release_root(temp)
            with patch.dict(os.environ, {'DAIRN_BUILD_TIME': STAMP}, clear=True):
                release = load_release(root)
            self.assertEqual(release['version'], NIGHTLY)
            self.assertEqual(release['python_version'], '2.3.4.dev20261024010203')
            self.assertEqual(tag_version('v' + NIGHTLY), NIGHTLY)
            self.assertEqual(artifact_names(release), {
                'npm': 'dairn-' + NIGHTLY + '.tgz',
                'wheel': 'dairn-2.3.4.dev20261024010203-py3-none-any.whl',
                'zip': 'dairn-' + NIGHTLY + '.zip'})

    def test_tag_version_accepts_v_prefix_only(self):
        self.assertEqual(tag_version('v2.3.4-rc.5'), '2.3.4-rc.5')
        self.assertEqual(tag_version('2.3.4'), '2.3.4')
        for name in ['release-2.3.4', 'v2.3', 'v2.3.4rc5']:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, '不是有效的发布版本'):
                tag_version(name)

    def release_root(self, temp, version='2.3.4', npm_name='dairn'):
        root = Path(temp)
        (root / 'tools').mkdir(exist_ok=True)
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
            branch = {'GITHUB_REF_TYPE': 'branch', 'GITHUB_REF_NAME': 'main', 'DAIRN_BUILD_TIME': STAMP}
            with patch.dict(os.environ, branch, clear=True):
                self.assertEqual(load_release(root)['version'], NIGHTLY)
            with patch.dict(os.environ, {'DAIRN_VERSION': '1.2'}, clear=True):
                with self.assertRaisesRegex(ValueError, '不是有效的发布版本'):
                    load_release(root)

    def test_package_json_base_is_the_fallback_version(self):
        with tempfile.TemporaryDirectory(prefix='dairn-version-') as temp:
            for base in ['3.0.0', '2.3.4-rc.5', '2.3.4-nightly.20261023000000']:
                with self.subTest(base=base), patch.dict(os.environ, {'DAIRN_BUILD_TIME': STAMP}, clear=True):
                    root = self.release_root(temp, version=base)
                    expected = base.split('-')[0] + '-nightly.20261024010203'
                    self.assertEqual(load_release(root)['version'], expected)
            for base in ['v2.3.4', '2.3']:
                with self.subTest(base=base), patch.dict(os.environ, {'DAIRN_BUILD_TIME': STAMP}, clear=True):
                    root = self.release_root(temp, version=base)
                    with self.assertRaisesRegex(ValueError, '三段数字'):
                        load_release(root)

    def test_explicit_version_skips_build_time(self):
        with tempfile.TemporaryDirectory(prefix='dairn-version-') as temp:
            root = self.release_root(temp)
            with patch.dict(os.environ, {}, clear=True):
                release = load_release(root, version='5.0.0-nightly.20260101000000')
            self.assertEqual(release['version'], '5.0.0-nightly.20260101000000')

    def test_release_json_rejects_version_fields(self):
        with tempfile.TemporaryDirectory(prefix='dairn-version-') as temp:
            root = self.release_root(temp)
            config = {'name': 'dairn', 'python_name': 'dairn'}
            for field in ('version', 'python_version', 'npm_version'):
                (root / 'tools/release.json').write_text(json.dumps({**config, field: '3.0.0'}), encoding='utf-8')
                with patch.dict(os.environ, {'DAIRN_BUILD_TIME': STAMP}, clear=True), \
                        self.assertRaisesRegex(ValueError, '标签或构建时间'):
                    load_release(root)
                (root / 'tools/release.json').write_text(json.dumps(config), encoding='utf-8')

    def test_version_from_archive_and_artifacts(self):
        with tempfile.TemporaryDirectory(prefix='dairn-artifacts-') as temp:
            root = self.release_root(temp)
            artifacts = root / 'dist'
            artifacts.mkdir()
            archive = artifacts / 'dairn-3.4.5-nightly.20261024010203.zip'
            archive.write_bytes(b'zip')
            self.assertEqual(version_from_archive(root, archive), '3.4.5-nightly.20261024010203')
            self.assertEqual(version_from_artifacts(root, artifacts), '3.4.5-nightly.20261024010203')
            (artifacts / 'dairn-3.4.6.zip').write_bytes(b'zip')
            with self.assertRaisesRegex(ValueError, '多个版本'):
                version_from_artifacts(root, artifacts)
            with self.assertRaisesRegex(ValueError, '无法从运行 ZIP'):
                version_from_archive(root, artifacts / 'dairn.whl')


if __name__ == '__main__':
    unittest.main()
