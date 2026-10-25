"""在含 Python、Git 和 Go 的 Linux 容器中运行核心及 Go 集成回归。"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(root))
# 集成测试必须像本地开发者一样运行：清除 CI 平台注入的环境变量，
# 否则 dairn check 会进入 CI 保护模式并要求 DAIRN_EXPECTED_POLICY_SHA256。
for _key in ('GITHUB_ACTIONS','GITHUB_EVENT_NAME','GITHUB_EVENT_PATH','GITHUB_REF','GITHUB_SHA',
             'GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_JOB','GITHUB_REPOSITORY','GITHUB_WORKFLOW',
             'GITLAB_CI','CI_PIPELINE_SOURCE','CI_MERGE_REQUEST_DIFF_BASE_SHA','CI_MERGE_REQUEST_LABELS'):
    os.environ.pop(_key, None)
binary = root / 'runtime/dairn-embedded.com'
# 验收本次构建，而不是 .dairn/runtime 中可能较旧的 vendored 快照。
os.environ['DAIRN_RUNTIME'] = str(binary)
before = hashlib.sha256(binary.read_bytes()).hexdigest()
results = {}
# 不自动下载新工具链或依赖；默认 Go 集成使用标准工具链，不启用 race/CGO。
os.environ.update(GOTOOLCHAIN='local', GOPROXY='off', CGO_ENABLED='0',
                  DAIRN_TEST_EVIDENCE_DIR=str(out))
for tool in ['git', 'go', 'openssl', 'jq', 'sha256sum']:
    if not shutil.which(tool):
        raise SystemExit('Linux 完整回归缺少工具：' + tool + '（容器镜像/runner 需预装 git/go/openssl/jq/coreutils）')
go_env = subprocess.run(['go', 'env', '-json', 'GOVERSION', 'GOOS', 'GOARCH',
                         'CGO_ENABLED', 'CC', 'GOTOOLCHAIN', 'GOPROXY'],
                        capture_output=True, check=True, timeout=30)
(out / 'linux-go-env.json').write_bytes(go_env.stdout)
results['go_environment'] = json.loads(go_env.stdout)
with tempfile.TemporaryDirectory(prefix='dairn-linux-native-') as tmp:
    native = Path(tmp) / 'qjs'
    shutil.copyfile(binary, native)
    native.chmod(0o755)
    subprocess.run(['/bin/sh', str(native), '--assimilate'], check=True)
    env = {**os.environ, 'DAIRN_QJS_BIN': str(native)}
    for name, script in [('core', 'test_core.mjs'), ('policy', 'test_native.mjs'), ('host', 'test_host_native.mjs'),
                         ('governance', 'test_governance_native.mjs'),
                         ('handoff', 'test_handoff_native.mjs'),
                         ('gov', 'test_gov_native.mjs'),
                         ('launcher', 'test_launcher_native.mjs')]:
        result = subprocess.run([str(native), str(root / 'quickjs/tests' / script)],
                                env=env, capture_output=True, timeout=40)
        (out / ('linux-' + name + '.log')).write_bytes(result.stdout + result.stderr)
        results[name] = result.returncode
        print(name, result.returncode, flush=True)
    suites = unittest.defaultTestLoader.loadTestsFromNames([
        'quickjs.tests.test_project_guidance',
        'quickjs.tests.test_workflow_facts',
        'quickjs.tests.test_work_intelligence',
        'quickjs.tests.test_assets_lint',
        'quickjs.tests.test_grill_workflow',
        'quickjs.tests.test_tasks_command',
        'quickjs.tests.test_hooks',
        'quickjs.tests.test_notes_seal',
        'quickjs.tests.test_launcher',
        'quickjs.tests.test_root_launcher',
        'quickjs.tests.test_doctor',
        'quickjs.tests.test_audit_logs',
        'quickjs.tests.test_review_identity',
        'quickjs.tests.test_agent_protocol',
        'quickjs.tests.test_analyzer_ci_review',
        'quickjs.tests.test_analyze_quality',
        'quickjs.tests.test_trusted_ci_analyzers',
        'quickjs.tests.test_project_lifecycle',
        'quickjs.tests.test_handoff',
        'quickjs.tests.test_governance_cli',
        'quickjs.tests.test_runtime_lock_diagnostic',
        'quickjs.tests.test_docs_retrieval',
    ])
    def flatten(suite):
        for case in suite:
            if isinstance(case, unittest.TestSuite):
                yield from flatten(case)
            else:
                yield case
    cases = list(flatten(suites))
    selected = unittest.TestSuite(cases)
    with (out / 'linux-regression.log').open('w', encoding='utf-8') as stream:
        regression = unittest.TextTestRunner(stream=stream, verbosity=2).run(selected)
    results.update(tests_run=regression.testsRun, failures=len(regression.failures),
                   errors=len(regression.errors), skipped=len(regression.skipped), excluded=[])
evidence = out / 'linux-go-checks.json'
if evidence.exists():
    results['go_checks'] = [{k: c.get(k) for k in ['id', 'module', 'status', 'exit_code', 'argv']}
                            for c in json.loads(evidence.read_text(encoding='utf-8'))['checks']]
results['ape_sha256'] = before
results['original_unchanged'] = hashlib.sha256(binary.read_bytes()).hexdigest() == before
(out / 'linux-summary.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
print(json.dumps(results, indent=2), flush=True)
sys.exit(0 if regression.wasSuccessful() and not regression.skipped and evidence.exists()
         and results['core'] == results['host'] == results['policy'] == results['governance'] == results['handoff'] == results['gov'] == 0
         and results['original_unchanged'] else 1)
