"""源码门禁的唯一必需测试目录；CI 和本地均由 check-source.py 执行。"""

NATIVE_UNIT = (
    'test_core.mjs', 'test_native.mjs', 'test_governance_native.mjs',
    'test_handoff_native.mjs', 'test_gov_native.mjs',
    'test_analysis_plan_native.mjs', 'test_launcher_native.mjs',
    'test_report_adapters_native.mjs', 'test_integrated_native.mjs', 'test_assurance_native.mjs',
)
PYTHON_INTEGRATION = (
    'quickjs.tests.test_integration_light',
    'quickjs.tests.test_doctor',
    'quickjs.tests.test_context_command',
    'quickjs.tests.test_runtime_lock_diagnostic',
    'quickjs.tests.test_docs_retrieval',
    'quickjs.tests.test_root_launcher',
    'quickjs.tests.test_analyze_quality',
)
CI_SOURCE_STAGES = ('lint', 'unit', 'integration')


def required_ids(stage):
    return {
        'lint': ('docs.check', 'python.assets-lint'),
        'unit': tuple('native.' + name.removesuffix('.mjs') for name in NATIVE_UNIT) + ('python.tools',),
        'integration': ('native.test_host_native',) + tuple(PYTHON_INTEGRATION),
        'build': ('launchers.check', 'build.python', 'build.npm', 'build.checksums'),
    }[stage]


def coverage(stage, results):
    """缺失、重复、额外或失败 Check-ID 均不能被聚合成成功。"""
    required = required_ids(stage)
    observed = [item['check_id'] for item in results]
    missing = sorted(set(required) - set(observed))
    unexpected = sorted(set(observed) - set(required))
    duplicates = sorted({item for item in observed if observed.count(item) > 1})
    return {'required': list(required), 'executed': observed, 'missing': missing,
            'unexpected': unexpected, 'duplicates': duplicates,
            'complete': not (missing or unexpected or duplicates)
                        and all(item['exit_code'] == 0 for item in results)}
