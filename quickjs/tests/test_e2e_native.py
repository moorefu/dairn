"""Native official Cosmo QuickJS differential and negative tests."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HOME = Path(__file__).resolve().parents[2]
SCRIPT = HOME / 'quickjs' / 'main.mjs'
QJS = Path(os.environ['DAIRN_QJS_BIN'])
OLD = HOME / 'test_oracle' / 'governance.py'

class PreviewCases(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root/'.dairn/governance/changes').mkdir(parents=True)
        (self.root/'.agents/skills/test-skill').mkdir(parents=True)
        (self.root/'.agents/skills/test-skill/SKILL.md').write_text('---\nname: test-skill\ndescription: Example\ndairn-stage: stable\n---\n')
        (self.root/'.agents/skills/test-skill/agents').mkdir()
        (self.root/'.agents/skills/test-skill/agents/openai.yaml').write_text('interface:\n  display_name: Test Skill\n')
        (self.root/'.agents/notes/archived').mkdir(parents=True)
        (self.root/'.agents/notes/archived/sha256.json').write_text('{}')
        for kind in ('feedback','incident','bug','release','action'):
            (self.root/'.dairn/governance/operations'/kind).mkdir(parents=True)

        for state in ('proposed','implemented','rejected'):
            (self.root/'.agents/notes'/state).mkdir(parents=True)
        (self.root/'docs').mkdir()
        (self.root/'AGENTS.md').write_text('Agent instructions')
        (self.root/'docs/GOVERNANCE_SPEC.md').write_text('Governance spec')
        self.policy={"schema_version":1,"modules":[{"name":"app","path":".","profiles":["generic"],"checks":{
          "lint":{"argv":["git","rev-parse","--git-dir"],"cwd":"."},
          "unit":{"argv":["git","rev-parse","HEAD"],"cwd":"."},
          "integration":{"argv":["git","status","--porcelain"],"cwd":"."},
          "build":{"argv":["git","rev-parse","--is-inside-work-tree"],"cwd":"."}
        }}],"required_checks":{"L0":["lint"],"L1":["lint","unit"],"L2":["lint","unit","integration","build"]}}
        self.write_policy()
        self.git('init','-q'); self.git('config','user.email','test@example.com'); self.git('config','user.name','Tester')
        (self.root/'src').mkdir()
        (self.root/'src/start.txt').write_text('initial')
        self.commit('initial')
        self.baseline=self.git('rev-parse','HEAD').stdout.strip()
    def tearDown(self):self.temp.cleanup()
    def git(self,*args):return subprocess.run(['git',*args],cwd=self.root,text=True,capture_output=True,check=True)
    def commit(self,msg):self.git('add','.'); self.git('commit','-qm',msg)
    def write_policy(self): (self.root/'.dairn/governance/project.json').write_text(json.dumps(self.policy))
    def js(self,*args,env=None):
        return subprocess.run([str(QJS),str(SCRIPT),*args,'--root',str(self.root)],capture_output=True,text=True,env=env)
    def test_structural_validation_and_unknown_command(self):
        self.assertEqual(self.js('validate-core').returncode,0)
        self.assertNotEqual(self.js('nonexistent').returncode,0)
    def test_policy_cannot_reduce_required_l2_checks(self):
        self.policy['required_checks']['L2']=['lint']
        self.write_policy()
        self.assertNotEqual(self.js('validate-core').returncode,0)
    def test_ci_requires_trusted_policy_hash(self):
        env={**os.environ,'GITLAB_CI':'true','CI_PIPELINE_SOURCE':'push'}
        self.assertNotEqual(self.js('check','--all',env=env).returncode,0)
    def test_trusted_policy_hash_conflict(self):
        env={**os.environ,'DAIRN_EXPECTED_POLICY_SHA256':'a'*64}
        self.assertNotEqual(self.js('check','--all',env=env).returncode,0)
    def test_trusted_policy_hash_pass(self):
        import hashlib
        digest=hashlib.sha256((self.root/'.dairn/governance/project.json').read_bytes()).hexdigest()
        env={**os.environ,'GITLAB_CI':'true','CI_PIPELINE_SOURCE':'push','DAIRN_EXPECTED_POLICY_SHA256':digest}
        self.assertEqual(self.js('check','--all',env=env).returncode,0)
    def test_bad_policy_blocked(self):
        self.policy['modules'][0]['checks']['lint']['argv']='git status'
        self.write_policy();self.assertNotEqual(self.js('validate-core').returncode,0)
    def test_path_escape_blocked(self):
        self.policy['modules'][0]['checks']['lint']['cwd']='../../';self.write_policy()
        self.assertNotEqual(self.js('validate-core').returncode,0)
    def test_no_diff_scope(self):
        p=self.js('scope','--base',self.baseline)
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual(json.loads(p.stdout)['paths'],[])
    def test_general_change_l1(self):
        (self.root/'src/main.go').write_text('package main\n')
        self.commit('add regular source')
        p=self.js('scope','--base',self.baseline)
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual(json.loads(p.stdout)['risk'],'L1')
    def test_high_risk_l2_and_evidence(self):
        (self.root/'src/auth-token.go').write_text('package main\n')
        self.commit('auth update')
        p=self.js('check','--base',self.baseline)
        self.assertEqual(p.returncode,0,p.stderr)
        runs=sorted((self.root/'.dairn/governance/evidence/runs').glob('*/*/run.json'))
        self.assertEqual(len(runs),1)
        run=json.loads(runs[0].read_text())
        self.assertEqual(run['schema'],'dairn.check-run.v1')
        self.assertEqual(run['execution']['risk'],'L2')
        self.assertEqual(len(run['checks']),4)
        self.assertEqual({r['status'] for r in run['checks']},{'passed'})
        self.assertEqual(run['declared_assurance'],'local-observed')
        self.assertEqual(len(run['execution']['policy_sha256']),64)
        self.assertEqual(run['subject']['source_commit'],self.git('rev-parse','HEAD').stdout.strip())
    def test_missing_gate_fails_closed(self):
        del self.policy['modules'][0]['checks']['integration']; self.write_policy()
        (self.root/'src/auth-token.go').write_text('package main\n');self.commit('auth update')
        self.assertEqual(self.js('check','--base',self.baseline).returncode,1)
        runs=sorted((self.root/'.dairn/governance/evidence/runs').glob('*/*/run.json'))
        run=json.loads(runs[-1].read_text())
        self.assertIn('missing',{r['status'] for r in run['checks']})
    def test_failed_command_fails_closed(self):
        self.policy['modules'][0]['checks']['unit']['argv']=['git','bad-command'];self.write_policy()
        (self.root/'src/main.go').write_text('package main\n');self.commit('add regular source')
        self.assertEqual(self.js('check','--base',self.baseline).returncode,1)
    def test_manifest_downgrade_fails(self):
        (self.root/'src/auth-token.go').write_text('package main\n')
        (self.root/'.dairn/governance/changes/test.json').write_text(json.dumps({
          'risk':'L0','summary':'test','rationale':'test','verification':['unit']}))
        self.commit('auth update')
        self.assertEqual(self.js('scope','--base',self.baseline).returncode,2)
    def test_pr_without_manifest_fails_closed(self):
        (self.root/'src/main.go').write_text('package main\n');self.commit('update')
        env={**os.environ,'GITHUB_ACTIONS':'true','GITHUB_EVENT_NAME':'pull_request'}
        self.assertNotEqual(self.js('check','--base',self.baseline,env=env).returncode,0)
    def test_git_head_mismatch_blocked(self):
        (self.root/'src/main.go').write_text('package main\n');self.commit('update')
        self.assertNotEqual(self.js('check','--base',self.baseline,'--head',self.baseline).returncode,0)
    def test_runtime_source_treated_as_governance_critical(self):
        for name in ('quickjs/core/engine.mjs','dairn/cli.py'):
            p=HOME/'quickjs'/'_critical_policy_probe_temp.mjs'
            # 显式 std.exit(0)：Windows 原生 APE 在脚本自然结束时可能崩溃，退出码不可信。
            p.write_text("import * as std from 'std'; import {classify} from './core/policy.mjs'; print(JSON.stringify(classify("+json.dumps([name])+"))); std.exit(0);",encoding='utf-8')
            try: r=subprocess.run([str(QJS),str(p)],capture_output=True,text=True)
            finally: p.unlink()
            self.assertEqual(r.returncode,0,r.stderr)
            self.assertEqual(json.loads(r.stdout)['risk'],'L2')

    def test_security_sensitive_entrypoints_are_critical_but_tools_allowlist_stays_narrow(self):
        critical=('ci/protected/build-protected.sh','ci/templates/github-protected.yml','tools/bootstrap.sh',
                  'tools/bootstrap.ps1','tools/build.py','tools/build.cjs','tools/build-npm.sh','tools/build-zip.mjs',
                  'tools/zip.mjs','tools/dairn_build_backend.py','tools/release_config.py','tools/release.json',
                  'tools/publish-release.py','bin/dairn.cjs','dairn.sh','dairn.cmd','build.sh','build.cmd','install.sh',
                  'package.json','pyproject.toml','src/dairn/cli.py','src/dairn/__init__.py','quickjs.lock.json',
                  'AGENTS.md','Makefile','.gitlab-ci.yml','.github/rulesets/main-branch.json')
        ordinary=('tools/verify-linux.py','tools/verify-packages.py','tools/checksums.py',
                  'tools/prepare-regression.py','tools/source_workspace.py','examples/stubs/go-surface/main.go')
        data=('.dairn/governance/evidence/run-qjs-checks.json','.dairn/work/task-1.json')
        probe=HOME/'quickjs'/'_critical_allowlist_probe_temp.mjs'
        program=("import * as std from 'std'; import {classify,moduleSelection} from './core/policy.mjs';"
                 "const critical="+json.dumps(list(critical))+",ordinary="+json.dumps(list(ordinary))+",data="+json.dumps(list(data))+";"
                 "const policy={schema_version:1,modules:[{path:'.'},{path:'tools'}]};"
                 "print(JSON.stringify({critical:critical.map(p=>classify([p])),"
                 "selected:critical.map(p=>moduleSelection(policy,[p]).length),"
                 "ordinary:ordinary.map(p=>classify([p])),data:data.map(p=>classify([p])),"
                 "modules:policy.modules.length}));std.exit(0);")
        try:
            probe.write_text(program,encoding='utf-8')
            result=subprocess.run([str(QJS),str(probe)],capture_output=True,text=True)
        finally:
            probe.unlink(missing_ok=True)
        self.assertEqual(result.returncode,0,result.stderr)
        report=json.loads(result.stdout)
        for name,value in zip(critical,report['critical']):
            self.assertEqual((value['risk'],value['governance_mode']),('L2','G2'),name)
            self.assertIn('governance-critical:'+name,value['risk_triggers'],name)
        for name,selected in zip(critical,report['selected']):
            self.assertEqual(selected,report['modules'],name)
        for name,value in zip(ordinary,report['ordinary']):
            self.assertEqual((value['risk'],value['governance_mode']),('L1','G1'),name)
            self.assertEqual(value['risk_triggers'],[],name)
        for name,value in zip(data,report['data']):
            self.assertEqual((value['risk'],value['governance_mode']),('L0','G0'),name)
    def test_all_baseline_check(self):
        p=self.js('check','--all')
        self.assertEqual(p.returncode,0,p.stderr)
        runs=sorted((self.root/'.dairn/governance/evidence/runs').glob('*/*/run.json'))
        run=json.loads(runs[-1].read_text())
        self.assertEqual(run['execution']['mode'],'baseline-all')
    @unittest.skipUnless(OLD.exists(), 'legacy differential oracle is not shipped')
    def test_legacy_classifier_differential(self):
        spec=importlib.util.spec_from_file_location('oldgov',OLD)
        mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        cases=[['docs/foo.md'],['src/main.go'],['src/auth/token.go'],['scripts/governance.py'],['.dairn/governance/changes/x.json'],['.dairn/governance/project.json'],['Makefile'],['.agents/notes/proposed/x.md'],['services/payment/process.go'],['README.md'],['.gitlab-ci.yml'],['src/main.go','docs/a.md'],['.github/workflows/q.yml']]
        program="import {classify} from './core/policy.mjs'; print(JSON.stringify("+json.dumps(cases)+".map(x=>classify(x))))"
        probe=HOME/'quickjs'/'_native_policy_probe_temp.mjs';probe.write_text(program);
        try:r=subprocess.run([str(QJS),str(probe)],cwd=HOME/'quickjs',capture_output=True,text=True)
        finally:probe.unlink()
        self.assertEqual(r.returncode,0,r.stderr)
        js=json.loads(r.stdout)
        for paths, val in zip(cases,js):
            lr,lm,reason=mod.classify_change(self.root,paths)
            self.assertEqual((val['risk'],val['governance_mode'],val['risk_triggers']),(lr,lm,reason),paths)

    def test_full_governance_validates_clean_project(self):
        p=self.js('validate')
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertIn('lifecycle: PASS',p.stdout)
        self.assertIn('docs: PASS',p.stdout)
    def test_skill_sidecar_mismatch_is_blocking(self):
        p=self.root/'.agents/skills/test-skill/agents/openai.yaml'
        p.write_text('interface:\n  display_name: Test\npolicy:\n  allow_implicit_invocation: false\n')
        run=self.js('validate')
        self.assertNotEqual(run.returncode,0)
        self.assertIn('skills:',run.stderr)
    def test_skill_deprecation_needs_replacement(self):
        p=self.root/'.agents/skills/test-skill/SKILL.md'
        p.write_text(p.read_text().replace('dairn-stage: stable','dairn-stage: deprecated'))
        run=self.js('validate')
        self.assertNotEqual(run.returncode,0)
        self.assertIn('replacement',run.stderr)
    def test_glossary_missing_definition_fails(self):
        (self.root/'GLOSSARY.md').write_text('# Glossary\n\n## Thing\n')
        run=self.js('validate')
        self.assertNotEqual(run.returncode,0)
        self.assertIn('glossary:',run.stderr)
    def test_tasks_cycle_fails(self):
        taskdir=self.root/'.dairn/governance/tasks';taskdir.mkdir()
        for tid,dep in [('TASK-a','TASK-b'),('TASK-b','TASK-a')]:
            (taskdir/(tid+'.json')).write_text(json.dumps({'id':tid,'title':tid,'acceptance':'yes','status':'ready','blocked_by':[dep]}))
        run=self.js('validate')
        self.assertNotEqual(run.returncode,0)
        self.assertIn('cycle',run.stderr)
    def test_feedback_same_red_green_fails(self):
        path=self.root/'.dairn/governance/engineering/feedback/one.json';path.parent.mkdir(parents=True)
        path.write_text(json.dumps({'id':'FB01','symptom':'wrong','command':'test','expected':'good','actual':'bad','red_evidence':'same','green_evidence':'same','head':'abc'}))
        run=self.js('validate')
        self.assertNotEqual(run.returncode,0)
        self.assertIn('red and green',run.stderr)
    def test_notes_missing_required_section_fails(self):
        path=self.root/'.agents/notes/implemented/architecture/2026-10-21-missing.md'
        path.parent.mkdir(parents=True)
        path.write_text('# Agent Note: Missing\n\nStatus: implemented\n\n## Problem\nExisting issue\n\n## Decision\nFix it\n\n## Consequences\nBetter\n')
        run=self.js('validate')
        self.assertNotEqual(run.returncode,0)
        self.assertIn('Alternatives considered',run.stderr)
    def test_archive_digest_mismatch_fails(self):
        path=self.root/'.agents/notes/archived/sha256.json'
        path.write_text(json.dumps({'architecture/2026-10-21-test.md':'a'*64}))
        run=self.js('validate')
        self.assertNotEqual(run.returncode,0)
        self.assertIn('archive:',run.stderr)
    def test_docs_duplicate_id_fails(self):
        base=self.root/'docs/specs/governance';base.mkdir(parents=True)
        doc='---\nid: dairn.fake.identity\ntitle: Example\nsummary: Example\nkind: spec\nmodule: governance\nkeywords: ["hello"]\naliases: []\nrelated: []\n---\n\n# Sample\n\n## Details\nText\n'
        (base/'one.md').write_text(doc)
        (base/'two.md').write_text(doc)
        run=self.js('validate')
        self.assertNotEqual(run.returncode,0)
        self.assertIn('duplicate ID',run.stderr)
    def test_lifecycle_record_bad_timestamp_fails(self):
        path=self.root/'.dairn/governance/operations/incident/INC-20261021-001.json'
        path.write_text(json.dumps({'schema_version':1,'id':'INC-20261021-001','type':'incident','title':'Issue','owner':'ops','severity':'SEV2',
          'status':'detected','links':{},'evidence':[],'details':{},'opened_at':'2026-10-21T10:00:00','updated_at':'2026-10-21T10:00:00',
          'history':[{'at':'2026-10-21T10:00:00','actor':'ops','from':None,'to':'detected','reason':'detected'}]}))
        run=self.js('validate')
        self.assertNotEqual(run.returncode,0)
        self.assertIn('lifecycle:',run.stderr)
    def test_lifecycle_history_rewrite_fails_with_base(self):
        path=self.root/'.dairn/governance/operations/feedback/FB-20261021-001.json'
        data={'schema_version':1,'id':'FB-20261021-001','type':'feedback','title':'Bad build','owner':'a','source':'test','status':'new',
          'links':{},'evidence':[],'details':{},'opened_at':'2026-10-21T00:00:00Z','updated_at':'2026-10-21T00:00:00Z',
          'history':[{'at':'2026-10-21T00:00:00Z','actor':'a','from':None,'to':'new','reason':'initial','evidence_refs':[]}]}
        path.write_text(json.dumps(data));self.commit('create feedback')
        trusted=self.git('rev-parse','HEAD').stdout.strip()
        data['history'][0]['reason']='rewritten';path.write_text(json.dumps(data))
        run=self.js('validate','--base',trusted)
        self.assertNotEqual(run.returncode,0)
        self.assertIn('append-only',run.stderr)
    def test_check_blocks_invalid_governance(self):
        (self.root/'GLOSSARY.md').write_text('# Glossary\n\n## Missing\n')
        run=self.js('check','--all')
        self.assertNotEqual(run.returncode,0)
        self.assertIn('glossary:',run.stderr)

if __name__ == '__main__': unittest.main()
