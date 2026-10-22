"""验证跨生态版本转换和唯一版本入口。"""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release_config import artifact_names, load_release, version_info


class ReleaseConfigTests(unittest.TestCase):
    def test_semver_to_python_version(self):
        cases = [('2.3.4', '2.3.4', False), ('2.3.4-alpha.0', '2.3.4a0', True),
                 ('2.3.4-beta.12', '2.3.4b12', True), ('2.3.4-rc.5', '2.3.4rc5', True)]
        for version, python_version, prerelease in cases:
            with self.subTest(version=version):
                self.assertEqual(version_info(version), {
                    'version': version, 'python_version': python_version, 'prerelease': prerelease})

    def test_invalid_versions_are_rejected(self):
        for version in ['v2.3.4', '2.3', '02.3.4', '2.3.4rc5', '2.3.4-rc.05', '2.3.4+local']:
            with self.subTest(version=version), self.assertRaises(ValueError):
                version_info(version)

    def test_only_package_json_controls_version(self):
        with tempfile.TemporaryDirectory(prefix='dairn-version-') as temp:
            root = Path(temp)
            (root / 'tools').mkdir()
            config = {'name': 'dairn', 'python_name': 'dairn'}
            (root / 'tools/release.json').write_text(json.dumps(config), encoding='utf-8')
            for version, wheel_version in [('2.3.4-rc.5', '2.3.4rc5'), ('3.0.0', '3.0.0')]:
                (root / 'package.json').write_text(json.dumps({'version': version}), encoding='utf-8')
                release = load_release(root)
                self.assertEqual(artifact_names(release), {
                    'npm': f'dairn-{version}.tgz', 'wheel': f'dairn-{wheel_version}-py3-none-any.whl',
                    'zip': f'dairn-{version}.zip'})
            for field in ('version', 'python_version', 'npm_version'):
                (root / 'tools/release.json').write_text(json.dumps({**config, field: '3.0.0'}), encoding='utf-8')
                with self.assertRaisesRegex(ValueError, '只允许定义在 package.json'):
                    load_release(root)


if __name__ == '__main__':
    unittest.main()
