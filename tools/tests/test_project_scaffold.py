"""治理脚手架模板回归：init/adopt 生成文本与启动器脚本必须与固定字面量/哈希一致。

模板事实源是 quickjs/assets/templates/project/（随运行时嵌入）。本测试用固定配置跑
init，对关键文件做 sha256 黄金断言，并验证模板确实随运行时嵌入——这样 core 装配层、
模板内容、启动器换行约定中任何一处意外漂移都会在 `check-source.py unit` 中失败。

每次 init 的成本主要在复制运行时负载与摘要计算，因此两次 init（python+none、go+both）
在类级夹具里并行执行一次，由多个断言方法共享；黄金断言与检查强度不因此减少。
"""
import concurrent.futures
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BUILT_RUNTIME = Path(os.environ['DAIRN_TEST_RUNTIME'])
RUNTIME = Path(os.environ.get('DAIRN_QJS_BIN') or BUILT_RUNTIME)
TEMPLATES = ROOT / 'quickjs/assets/templates/project'
TEMPLATE_PREFIX = 'quickjs/assets/templates/project/'

# 固定哈希夹具：由 PR-C 迁移前的基线场景（.build/tmp/parity/baseline.json）锁定字节级 parity。
AGENTS_SHA = '767c2c3cd1b1d5f51279dbd63b57f0b77492eba02615f75b055d18d46250d1da'
GOVERNANCE_SPEC_SHA = '75b2360a9d0ad208927cce68e2a217cda2a3662609d701b4e97782348bbfd468'
CLAUDE_SHA = 'ccc1cc398135b0088923e576f40a3ad6bf0f8b3c7ce9a8be13b90fb4f7c7b55c'
ROOT_GITATTRIBUTES_SHA = '445484c73a4566b7f91a0530c782cb2c710b95bfcf7373c4a06d46b49e586362'
DAIRN_GITATTRIBUTES_SHA = 'f414e9951ccce8606c6d92cf9220e3a5a38af0c5d461f4ebd271704db15b0fa4'
POSIX_LAUNCHER_SHA = 'ff24bb29cde332daa500021cde309990f7af469c362a3fc559ccb433a7a26a4a'
WINDOWS_LAUNCHER_SHA = '23eba37f99b09dd6661a85b469780acebe8af8eaaae73481c1b4d4cea4e20ee9'
ANALYZERS_JSON_SHA = '99c90041e112a712d4e5bad2a5924475fa8f53b945198ffeb6fe0fc5e63ae03b'
GITIGNORE_SHA = '5d3862048ea3b9f4893b00db5a2cae620c7bedb6009a191372cb6bdda8907c55'
PYTHON = {
    'README.md': 'b1741476dc3472de424b749d1c6263052b218738ed6ff3b47012d079ccd26aeb',
    'docs/PROJECT_GUIDE.md': '7a67d5f2ed3378fb7b0e518db1fb1adea7e68d751858080646216e961fc6fcb1',
}
GO = {
    'README.md': 'a6d2bf019d4f4038098fb00b8e0ade339394ed9c51dccf18573e686e46b31aa8',
    'docs/PROJECT_GUIDE.md': 'd9026a703b96ccec0442dc63cc18cdf3725782b79e8177bbcec5183f67e8a508',
}
CI_GITHUB_SHA = '77cb9add9d04b5a04168928532fc44754abcb9fea7b03dcd447efae18d78c774'
CI_GITLAB_SHA = '5af69e995cfc1c997e9e4efe323159d7bf3d896638648030eb0db8f491cb22bc'
TEMPLATE_EMBEDDED = {
    'agents-navigation.md': '0965fc7eee873ecd47561a70ef9a7f38580f34bf6bd9174cc682d2d638fd8f7a',
    'project-readme.md': 'bc55c4eaa3bfd2b96a971dd713b37c546da3dfd5ce8fc7a1a99b5fcc1e1aac9b',
    'project-guide.md': 'c60d750e1a3a01f671ab9ae4b548d11507e85c446f13d7e4b121e4c55340b15b',
    'governance-spec.md': GOVERNANCE_SPEC_SHA,
    'claude.md': CLAUDE_SHA,
    'gitattributes-root.txt': ROOT_GITATTRIBUTES_SHA,
    'gitattributes-dairn.txt': DAIRN_GITATTRIBUTES_SHA,
    'ci-github.yml': CI_GITHUB_SHA,
    'ci-gitlab.yml': CI_GITLAB_SHA,
    'launcher/dairn.sh': POSIX_LAUNCHER_SHA,
    'launcher/dairn.cmd': '090778a2fda25af0c6c83f700de4fd90af66690ebee81c123a150628c519bdfe',
}


def _temp_root():
    """优先在仓库忽略目录里建夹具，便于受限沙箱环境；否则退回系统临时目录。"""
    build = ROOT / '.build/tmp'
    try:
        build.mkdir(parents=True, exist_ok=True)
        return tempfile.TemporaryDirectory(prefix='dairn-scaffold-', dir=build)
    except OSError:
        return tempfile.TemporaryDirectory(prefix='dairn-scaffold-')


def _run_init(project, args):
    """在独立项目目录执行一次 init；失败时抛出带子进程输出摘要的断言错误。"""
    env = dict(os.environ,
               DAIRN_RUNTIME=str(RUNTIME),
               DAIRN_RUNTIME_DIR=str(RUNTIME.parent),
               DAIRN_RUNTIME_SOURCE='external',
               PYTHONDONTWRITEBYTECODE='1')
    result = subprocess.run(
        [str(ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn')),
         'init', '--name', 'parity_demo', '--apply'] + args,
        cwd=project, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace',
        timeout=180)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or '').strip()
        raise AssertionError('init 失败（%s，exit %s）：%s'
                             % (' '.join(args), result.returncode, detail))
    return result


def _init_project(base, label, stack, ci):
    project = base / label
    project.mkdir()
    _run_init(project, ['--stack', stack, '--ci', ci])
    return project


@unittest.skipUnless(RUNTIME.is_file(), '需要先构建仓库根 runtime/dairn-embedded.com（python tools/build.py）')
@unittest.skipUnless(TEMPLATES.is_dir(), '缺少 quickjs/assets/templates/project 模板目录')
class ProjectScaffoldTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        """并行构建两个 init 夹具（python+none、go+both），供全部黄金断言方法共享。

        两次 init 使用各自独立的临时项目目录；subprocess 释放 GIL，故 2 个 init 的
        wall time 约等于单次 init；低核环境最坏退化为串行。夹具失败时汇总带输出的
        错误，避免逐个测试重复尝试。
        """
        temp = _temp_root()
        try:
            base = Path(temp.name)
            specs = (
                ('python-none', 'python', 'none'),
                ('go-both', 'go', 'both'),
            )
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                futures = {label: pool.submit(_init_project, base, label, stack, ci)
                           for label, stack, ci in specs}
            projects = {}
            failures = []
            for label, future in futures.items():
                try:
                    projects[label] = future.result()
                except Exception as exc:  # 汇总全部并行夹具错误，统一报告后再失败
                    failures.append('%s: %s' % (label, exc))
            if failures:
                raise AssertionError('脚手架夹具 init 失败：\n' + '\n'.join(failures))
        except BaseException:
            temp.cleanup()
            raise
        cls.addClassCleanup(temp.cleanup)
        cls.projects = projects

    def _sha(self, path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def assertScaffold(self, project, expected):
        files = {
            'AGENTS.md': AGENTS_SHA,
            'CLAUDE.md': CLAUDE_SHA,
            'docs/GOVERNANCE_SPEC.md': GOVERNANCE_SPEC_SHA,
            '.gitattributes': ROOT_GITATTRIBUTES_SHA,
            '.dairn/.gitattributes': DAIRN_GITATTRIBUTES_SHA,
            'dairn': POSIX_LAUNCHER_SHA,
            'dairn.cmd': WINDOWS_LAUNCHER_SHA,
            '.dairn/analyzers.json': ANALYZERS_JSON_SHA,
            '.gitignore': GITIGNORE_SHA,
        }
        files.update(expected)
        for rel, want in files.items():
            self.assertEqual(self._sha(project / rel), want, '脚手架文本哈希漂移：' + rel)
        # 占位符必须全部替换；受管启动器换行约定（POSIX LF / Windows CRLF）保持稳定。
        for path in project.rglob('*'):
            if not path.is_file():
                continue
            rel = path.relative_to(project).as_posix()
            if rel == '.dairn/runtime' or rel.startswith('.dairn/runtime/'):
                continue
            # GitHub Actions 表达式本身使用 ${{ ... }}，由 CI 模板哈希断言覆盖。
            if rel.startswith('.github/workflows/') or rel == '.gitlab-ci.yml':
                continue
            text = path.read_bytes().decode('utf-8', errors='ignore')
            self.assertNotIn('{{', text, '占位符未替换：' + str(path.relative_to(project)))
        self.assertNotIn(b'\r', (project / 'dairn').read_bytes(), 'POSIX 启动器必须为 LF')
        windows = (project / 'dairn.cmd').read_bytes()
        self.assertTrue(windows.endswith(b'\r\n') and b'\r\n' in windows, 'Windows 启动器必须为 CRLF')

    def test_init_python_none_matches_golden_bytes(self):
        project = self.projects['python-none']
        self.assertScaffold(project, PYTHON)
        # --ci none 必须不生成 CI 模板；占位符扫描刻意跳过 CI 文件，故在此显式断言。
        self.assertFalse((project / '.github/workflows/dairn.yml').exists(),
                         '--ci none 不应生成 GitHub CI 模板')
        self.assertFalse((project / '.gitlab-ci.yml').exists(),
                         '--ci none 不应生成 GitLab CI 模板')

    def test_init_go_both_matches_golden_bytes(self):
        project = self.projects['go-both']
        self.assertScaffold(project, GO)
        self.assertEqual(self._sha(project / '.github/workflows/dairn.yml'), CI_GITHUB_SHA,
                         'GitHub CI 模板哈希漂移')

    def test_init_go_both_gitlab_ci_template(self):
        project = self.projects['go-both']
        self.assertEqual(self._sha(project / '.gitlab-ci.yml'), CI_GITLAB_SHA, 'GitLab CI 模板哈希漂移')

    def test_templates_embedded_in_runtime(self):
        with zipfile.ZipFile(RUNTIME) as archive:
            names = set(archive.namelist())
            for rel, want in TEMPLATE_EMBEDDED.items():
                member = TEMPLATE_PREFIX + rel
                self.assertIn(member, names, '运行时应嵌入脚手架模板：' + member)
                embedded = archive.read(member)
                self.assertEqual(hashlib.sha256(embedded).hexdigest(), want, '嵌入模板哈希漂移：' + member)
                self.assertEqual(embedded, (TEMPLATES / rel).read_bytes(),
                                 '源码模板与嵌入模板不一致：' + rel)


if __name__ == '__main__':
    unittest.main()
