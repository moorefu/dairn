"""Actual Bellard Cosmo QuickJS APE agent-first protocol integration tests.
Runs Dairn itself and real Go gates; never mocks an AI executor.
"""
from pathlib import Path
import json, subprocess, tempfile, unittest

RUNTIME=Path(__file__).resolve().parents[2]
CLI=RUNTIME/'dairn.sh'

class AgentProtocol(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dairn-agent-v11-')
        self.root=Path(self.tmp.name)/'proj'
        self.cmd('init','--path',self.root,'--stack','go','--sample',ok=True)
    def tearDown(self):self.tmp.cleanup()
    def cmd(self,*args,ok=False):
        p=subprocess.run([str(CLI),*map(str,args)],cwd=self.tmp.name,text=True,capture_output=True,timeout=90)
        if ok:self.assertEqual(p.returncode,0,p.stdout+'\n'+p.stderr)
        return p
    def obj(self,*args):return json.loads(self.cmd(*args,ok=True).stdout)
    def work(self,*args):return self.obj('work',*args,'--root',self.root)
    def git(self,*args):return subprocess.run(['git',*args],cwd=self.root,text=True,capture_output=True,check=True).stdout.strip()
    def commit_base(self):
        self.git('init','-q');self.git('config','user.name','Tester');self.git('config','user.email','tester@example.com')
        self.git('add','.');self.git('commit','-qm','baseline');return self.git('rev-parse','HEAD')
    def go_change(self):
        path=self.root/'auth.go';path.write_text('package hello\n\nfunc VerifyToken(token string) bool {\n\treturn len(token) > 0\n}\n');
        self.git('add','auth.go');self.git('commit','-qm','add verification');return self.git('rev-parse','HEAD')
    def implement(self):
        self.work('start','Implement authentication feature','--id','auth')
        (self.root/'grill.json').write_text(json.dumps({'schema':1,'task_id':'auth','questions':[
            {'id':'q1','prompt':'How should the authentication token be validated?',
             'recommendation':'Use a short-lived signed token','status':'resolved',
             'decision':'Short-lived signed token, verified on every request'}]}))
        for path,kind in [('README.md','note'),('grill.json','grill'),('README.md','spec'),('README.md','note')]:
            self.work('record','auth',path,'--kind',kind)
            self.work('advance','auth')
        self.assertEqual(self.work('next','auth','--json')['current_stage'],'implement')
    def test_contract_is_structured_and_ai_is_external(self):
        self.work('start','Fix bug in login','--id','auth')
        manifest=self.work('next','auth','--json')['next']
        self.assertEqual(manifest['executor'],'agent');self.assertEqual(manifest['task_id'],'auth')
        self.assertTrue(manifest['requirements']);self.assertIn('does not call',manifest['agent_invocation'])
    def test_implementation_requires_real_linked_check(self):
        self.implement()
        self.assertNotEqual(self.cmd('work','verify','auth','--require-machine-gates','--root',self.root).returncode,0)
        self.assertNotEqual(self.cmd('work','advance','auth','--root',self.root).returncode,0)
    def test_check_task_runs_independent_of_stage(self):
        # RUN-02: Check is Task-independent; referencing a task from any stage
        # neither blocks the check nor changes its outcome.
        self.work('start','Implement authentication feature','--id','auth')
        base=self.commit_base();self.go_change()
        self.assertNotEqual(self.cmd('check','--root',self.root,'--all','--task','auth').returncode,0)
        passed=self.cmd('check','--root',self.root,'--base',base,'--task','auth',ok=True)
        self.assertIn('Linked task run',passed.stdout)
    def test_failed_then_successful_run_and_machine_evidence(self):
        self.implement();base=self.commit_base();self.go_change()
        src=self.root/'auth.go';src.write_text(src.read_text().replace('\n\treturn','\n    return'))
        self.git('add','auth.go');self.git('commit','-qm','break formatting')
        failed=self.cmd('check','--root',self.root,'--base',base,'--task','auth')
        self.assertEqual(failed.returncode,1,failed.stderr+failed.stdout)
        self.assertNotEqual(self.cmd('work','advance','auth','--root',self.root).returncode,0)
        subprocess.run(['gofmt','-w',src],check=True)
        self.git('add','auth.go');self.git('commit','-qm','fix format')
        passed=self.cmd('check','--root',self.root,'--base',base,'--task','auth',ok=True)
        self.assertIn('Linked task run',passed.stdout)
        task=json.loads((self.root/'.dairn/work/auth.json').read_text())
        runs=task['stages'][4]['machine_runs'];self.assertEqual([x['status'] for x in runs],['failed','passed'])
        # Task links now reference the v1 protocol run (dairn.check-run.v1).
        self.assertIn('runs/',runs[-1]['path'])
        raw=json.loads((self.root/runs[-1]['path']).read_text())
        self.assertEqual(raw['schema'],'dairn.check-run.v1')
        self.assertEqual(raw['related_tasks'],['auth'])
        self.assertEqual(raw['subject']['source_commit'],self.git('rev-parse','HEAD'))
        self.assertEqual(raw['subject']['base_commit'],base)
        self.assertEqual(raw['declared_assurance'],'local-observed')
        self.assertEqual(len(raw['execution']['snapshot_before_sha256']),64)
        self.assertEqual(len(raw['checks']),4);self.assertTrue(all(c['log_sha256'] for c in raw['checks']))
        self.assertTrue(self.work('verify','auth','--require-machine-gates')['machine_gates_required'])
        self.assertEqual(self.work('advance','auth')['next']['id'],'review')
    def test_mutated_run_file_rejected(self):
        self.implement();base=self.commit_base();self.go_change()
        self.cmd('check','--base',base,'--task','auth','--root',self.root,ok=True)
        task=json.loads((self.root/'.dairn/work/auth.json').read_text())
        file=self.root/task['stages'][4]['machine_runs'][0]['path']
        file.write_text(file.read_text().replace('"declared_assurance": "local-observed"','"declared_assurance": "ci-verified"'))
        self.assertNotEqual(self.cmd('work','verify','auth','--root',self.root).returncode,0)
        self.assertNotEqual(self.cmd('work','advance','auth','--root',self.root).returncode,0)
    def test_stale_run_head_rejected(self):
        self.implement();base=self.commit_base();self.go_change()
        self.cmd('check','--base',base,'--task','auth','--root',self.root,ok=True)
        (self.root/'hello.go').write_text((self.root/'hello.go').read_text()+'\n// change\n')
        self.git('add','hello.go');self.git('commit','-qm','new commit')
        self.assertNotEqual(self.cmd('work','verify','auth','--require-machine-gates','--root',self.root).returncode,0)
        self.assertNotEqual(self.cmd('work','advance','auth','--root',self.root).returncode,0)

    def test_passing_machine_evidence_rejects_dirty_worktree(self):
        self.implement();base=self.commit_base();self.go_change()
        self.cmd('check','--base',base,'--task','auth','--root',self.root,ok=True)
        self.assertEqual(self.cmd('work','verify','auth','--require-machine-gates','--root',self.root).returncode,0)
        # 已跟踪源码（非任务证据文件）的未提交改动：HEAD 未变也必须让证据失效。
        hello=self.root/'hello.go'
        hello.write_text(hello.read_text()+'\n// uncommitted source context\n')
        result=self.cmd('work','verify','auth','--require-machine-gates','--root',self.root)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Worktree changed',result.stdout+result.stderr)
        self.assertNotEqual(self.cmd('work','advance','auth','--root',self.root).returncode,0)

    def test_passing_machine_evidence_rejects_new_untracked_source_file(self):
        self.implement();base=self.commit_base();self.go_change()
        self.cmd('check','--base',base,'--task','auth','--root',self.root,ok=True)
        # 未绑定、非 Dairn 数据的未追踪源码文件也必须让证据失效。
        (self.root/'late.go').write_text('package hello\n')
        result=self.cmd('work','verify','auth','--require-machine-gates','--root',self.root)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Worktree changed',result.stdout+result.stderr)

    def test_machine_evidence_survives_task_records_and_advance(self):
        self.implement();base=self.commit_base();self.go_change()
        self.cmd('check','--base',base,'--task','auth','--root',self.root,ok=True)
        # attachCheckRun 会改写任务账本、写证据与日志；这些 Dairn 数据与已按 sha256
        # 绑定的证据不得让刚通过的运行自我失效。
        self.assertTrue(self.work('verify','auth','--require-machine-gates')['machine_gates_required'])
        self.assertEqual(self.work('advance','auth')['next']['id'],'review')
        head=self.git('rev-parse','HEAD')
        review=self.root/'review.json'
        review.write_text(json.dumps({'standards':'pass','spec_fidelity':'not-applicable','head':head}))
        self.work('record','auth','review.json','--kind','review')
        # 推进离开 review 时会再次核对 machine gate；未追踪的 review.json 已被账本绑定。
        handed=self.work('advance','auth')
        self.assertEqual(handed['next']['id'],'synchronize')

    def test_policy_change_invalidates_machine_evidence(self):
        self.implement();base=self.commit_base();self.go_change()
        self.cmd('check','--base',base,'--task','auth','--root',self.root,ok=True)
        policy=self.root/'.dairn/governance/project.json'
        policy.write_text(policy.read_text()+'\n')
        result=self.cmd('work','verify','auth','--require-machine-gates','--root',self.root)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Policy changed',result.stdout+result.stderr)

    def gate_reason(self,project,gate='lint'):
        evidence=json.loads((project/'.dairn/governance/evidence/all-qjs-checks.json').read_text(encoding='utf-8'))
        record=next(c for c in evidence['checks'] if c['gate']==gate)
        return record.get('reason') or ''
    def test_go_lint_git_mode_empty_list_fails_closed(self):
        empty=Path(self.tmp.name)/'empty-go'
        self.cmd('init','--path',empty,'--stack','go',ok=True)
        (empty/'.gitignore').write_text('ignored.go\n')
        (empty/'ignored.go').write_text('package ignored\n')
        subprocess.run(['git','init','-q'],cwd=empty,check=True)
        subprocess.run(['git','config','user.name','Tester'],cwd=empty,check=True)
        subprocess.run(['git','config','user.email','tester@example.com'],cwd=empty,check=True)
        subprocess.run(['git','add','.'],cwd=empty,check=True)
        subprocess.run(['git','commit','-qm','empty go baseline'],cwd=empty,check=True)
        result=self.cmd('check','--all','--root',empty)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('No Go files available in Git',self.gate_reason(empty))

    def test_go_lint_non_git_symlink_directory_refused(self):
        non_git=Path(self.tmp.name)/'linked-go'
        self.cmd('init','--path',non_git,'--stack','go','--sample',ok=True)
        outside=Path(self.tmp.name)/'outside-go';outside.mkdir()
        (outside/'outside.go').write_text('package outside\n')
        try:
            (non_git/'linked').symlink_to(outside,target_is_directory=True)
        except OSError as error:
            self.skipTest('symlink unavailable: '+str(error))
        result=self.cmd('check','--all','--root',non_git)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Go lint refuses symlink path',self.gate_reason(non_git))

    def test_go_lint_tracked_symlink_file_refused(self):
        project=Path(self.tmp.name)/'tracked-link-go'
        self.cmd('init','--path',project,'--stack','go','--sample',ok=True)
        outside=Path(self.tmp.name)/'outside-target.go';outside.write_text('package outside\n')
        try:
            (project/'link.go').symlink_to(outside)
        except OSError as error:
            self.skipTest('symlink unavailable: '+str(error))
        subprocess.run(['git','init','-q'],cwd=project,check=True)
        subprocess.run(['git','config','user.name','Tester'],cwd=project,check=True)
        subprocess.run(['git','config','user.email','tester@example.com'],cwd=project,check=True)
        subprocess.run(['git','add','-A'],cwd=project,check=True)
        subprocess.run(['git','commit','-qm','tracked go symlink'],cwd=project,check=True)
        mode=subprocess.run(['git','ls-files','-s','link.go'],cwd=project,text=True,capture_output=True,check=True).stdout
        if not mode.startswith('120000'):
            self.skipTest('git checkout does not preserve symlinks: '+mode.strip())
        result=self.cmd('check','--all','--root',project)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Go lint refuses symlink path',self.gate_reason(project))
    def add_relation(self):
        folder=self.root/'docs/specs/app';folder.mkdir(parents=True,exist_ok=True)
        (folder/'auth.md').write_text('---\nid: project.auth\ntitle: Auth\nsummary: Contract\nkind: spec\nmodule: app\nkeywords: ["authentication", "API"]\naliases: []\nrelated: []\n---\n\n# Auth\n')
        p=self.root/'.dairn/relations.json'
        p.write_text(json.dumps({'schema':1,'bindings':[{'spec_id':'project.auth','symbol':{'path':'hello.go','name':'Greeting'},'tests':['hello_test.go'],'docs':['docs/PROJECT_GUIDE.md']}]}))
        return p
    def test_explicit_relation_impacts_and_registry_validates(self):
        self.add_relation();self.cmd('guide','facts','--apply','--root',self.root,ok=True)
        base=self.commit_base()
        src=self.root/'hello.go';src.write_text(src.read_text().replace('Greeting() string','Greeting(user string) string'))
        rep=self.obj('guide','impact','--base',base,'--root',self.root)
        self.assertEqual(rep['status'],'review-required')
        self.assertEqual(rep['relationships']['explicit_bindings'],1)
        hit=next(x for x in rep['impacts'] if x['category']=='public-surface')
        self.assertEqual(hit['explicit_relations'][0]['spec_id'],'project.auth')
        self.assertIn('docs/PROJECT_GUIDE.md',hit['affected_docs'])
        self.cmd('validate','--root',self.root,ok=True)
    def test_relation_registry_fails_closed_on_dangling_symbol(self):
        path=self.add_relation();config=json.loads(path.read_text());config['bindings'][0]['symbol']['name']='Unobserved'
        path.write_text(json.dumps(config))
        self.assertNotEqual(self.cmd('guide','impact','--root',self.root).returncode,0)
        self.assertNotEqual(self.cmd('validate','--root',self.root).returncode,0)
    def test_registry_rejects_symlink_target(self):
        path=self.add_relation();external=Path(self.tmp.name)/'bad.md';external.write_text('not project owned')
        (self.root/'docs/linked.md').symlink_to(external)
        config=json.loads(path.read_text());config['bindings'][0]['docs']=['docs/linked.md'];path.write_text(json.dumps(config))
        self.assertNotEqual(self.cmd('guide','impact','--root',self.root).returncode,0)
    def test_registry_rejects_symlinked_parent_directory(self):
        path=self.add_relation()
        outside=Path(self.tmp.name)/'outside-docs';outside.mkdir()
        (outside/'guide.md').write_text('external content')
        (self.root/'docs/external').symlink_to(outside, target_is_directory=True)
        config=json.loads(path.read_text());config['bindings'][0]['docs']=['docs/external/guide.md'];path.write_text(json.dumps(config))
        self.assertNotEqual(self.cmd('validate','--root',self.root).returncode,0)
    def test_trusted_base_discards_pr_rewritten_registry(self):
        rel=self.add_relation();self.cmd('guide','facts','--apply','--root',self.root,ok=True)
        base=self.commit_base()
        rel.write_text(json.dumps({'schema':1,'bindings':[]}))
        src=self.root/'hello.go';src.write_text(src.read_text().replace('Greeting() string','Greeting(user string) string'))
        self.git('add','.');self.git('commit','-qm','change public contract and hide links')
        rep=self.obj('guide','impact','--base',base,'--root',self.root)
        self.assertEqual(rep['relationships']['source'],'git:'+base)
        self.assertEqual(rep['relationships']['explicit_bindings'],1)
        self.assertIn('relation-registry',[x['category'] for x in rep['impacts']])
        self.assertIn('project.auth',str(rep['impacts']))
    def configure_stub(self):
        analyzer=RUNTIME/'examples/stubs/go-surface/main.go'
        (self.root/'.dairn/stubs.json').write_text(json.dumps({'schema':1,'stubs':[{'id':'surface','kind':'surface-analysis','argv':['go','run',str(analyzer)],'cwd':'.','timeout_seconds':120}]}))
    def test_project_stub_uses_go_toolchain(self):
        self.configure_stub();base=self.commit_base();self.go_change()
        rep=self.obj('guide','impact','--base',base,'--precision','surface','--root',self.root)
        self.assertEqual(rep['stub_analysis']['stub_id'],'surface')
        self.assertTrue(rep['stub_analysis']['changes'])
    def test_spec_binding_deleted_symbol_still_affects_baseline(self):
        self.add_relation();self.cmd('guide','facts','--apply','--root',self.root,ok=True)
        base=self.commit_base()
        (self.root/'hello.go').write_text('package hello\n')
        rep=self.obj('guide','impact','--base',base,'--root',self.root)
        self.assertEqual(rep['relationships']['explicit_bindings'],1)
    def test_multiline_go_ast_signature_detected(self):
        self.configure_stub();base=self.commit_base()
        src=self.root/'hello.go';src.write_text('package hello\n\nfunc Greeting(\n    user string,\n) string { return user }\n')
        rep=self.obj('guide','impact','--base',base,'--precision','surface','--root',self.root)
        self.assertTrue(any(x['path']=='hello.go' and 'func:Greeting' in x['symbol'] for x in rep['stub_analysis']['changes']))
        self.assertEqual(rep['status'],'review-required')
    def test_invalid_go_syntax_fails_precise_analysis(self):
        self.configure_stub();base=self.commit_base()
        src=self.root/'hello.go';src.write_text('package hello\nfunc Greeting(\n')
        self.assertNotEqual(self.cmd('guide','impact','--base',base,'--precision','surface','--root',self.root).returncode,0)
    def test_task_records_do_not_escalate_to_l2(self):
        base=self.commit_base()
        self.work('start','Do some housekeeping','--id','tidy')
        self.git('add','.dairn/work');self.git('commit','-qm','record task')
        report=self.obj('scope','--base',base,'--root',self.root)
        self.assertEqual(report['risk'],'L0')
    def test_relation_registry_changes_remain_critical_l2(self):
        base=self.commit_base()
        self.add_relation()
        self.git('add','.dairn/relations.json','docs/specs');self.git('commit','-qm','new contracts')
        report=self.obj('scope','--base',base,'--root',self.root)
        self.assertEqual(report['risk'],'L2')
    def test_check_task_requires_nonempty_git_diff(self):
        self.implement();base=self.commit_base()
        self.assertNotEqual(self.cmd('check','--base',base,'--task','auth','--root',self.root).returncode,0)

if __name__=='__main__':unittest.main()
