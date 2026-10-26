"""原生 QuickJS 工作和影响分析集成测试。"""
from pathlib import Path
import hashlib, json, os, subprocess, sys, tempfile, unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/('dairn.cmd' if os.name=='nt' else 'dairn')
class WorkIntelligence(unittest.TestCase):
    def setUp(self):
        (ROOT/'.dairn/tmp').mkdir(parents=True, exist_ok=True)
        self.tmp=tempfile.TemporaryDirectory(prefix='dairn-v10-', dir=str(ROOT/'.dairn/tmp'))
        self.repo=Path(self.tmp.name)/'service'
        self.env={**os.environ, 'GIT_CEILING_DIRECTORIES': str(Path(self.tmp.name).parent),
                  'TMPDIR': self.tmp.name, 'TEMP': self.tmp.name, 'TMP': self.tmp.name,
                  'GOCACHE': str(Path(self.tmp.name) / 'go-cache')}
        self.ok('init','--path',self.repo,'--stack','go','--sample')
    def tearDown(self):self.tmp.cleanup()
    def call(self,*args):
        return subprocess.run([str(CLI),*map(str,args)],cwd=self.tmp.name,env=self.env,
                              text=True,capture_output=True,encoding='utf-8',errors='replace')
    def ok(self,*args):
        p=self.call(*args)
        self.assertEqual(p.returncode,0,p.stdout+'\n'+p.stderr)
        return p
    def obj(self,*args):return json.loads(self.ok(*args).stdout)
    def w(self,*args):return self.obj('work',*args,'--root',self.repo)
    def start(self,title='Fix login bug',id='login'):
        return self.w('start',title,'--id',id)
    def git(self,*args):
        return subprocess.run(['git',*args],cwd=self.repo,text=True,capture_output=True,check=True).stdout.strip()
    def commit(self):
        self.git('init','-q');self.git('config','user.name','Test');self.git('config','user.email','test@example.com')
        self.git('add','.');self.git('commit','-qm','baseline');return self.git('rev-parse','HEAD')
    def test_start_resume_stage_selection(self):
        r=self.start();self.assertEqual(r['next']['skill'],'dairn-spec-discovery')
        self.assertEqual(self.w('next','login')['current_stage'],'orient')
        self.assertEqual(len(self.w('list')),1)
        self.assertTrue((self.repo/'.dairn/work/login.json').exists())
    def test_duplicate_and_invalid_ids_fail_without_clobber(self):
        self.start();p=self.repo/'.dairn/work/login.json';before=p.read_bytes()
        self.assertNotEqual(self.call('work','start','Duplicate','--id','login','--root',self.repo).returncode,0)
        self.assertNotEqual(self.call('work','start','Bad','--id','../outside','--root',self.repo).returncode,0)
        self.assertEqual(before,p.read_bytes())
    def test_requires_evidence_before_transition(self):
        self.start()
        r=self.call('work','advance','login','--root',self.repo)
        self.assertNotEqual(r.returncode,0)
        self.w('record','login','README.md','--kind','document')
        r=self.w('advance','login');self.assertEqual(r['next']['id'],'diagnose')
    def test_evidence_change_blocks_verify_and_advance(self):
        self.start();self.w('record','login','README.md','--kind','document')
        (self.repo/'README.md').write_text('Modified after recording',encoding='utf-8')
        self.assertNotEqual(self.call('work','verify','login','--root',self.repo).returncode,0)
        self.assertNotEqual(self.call('work','advance','login','--root',self.repo).returncode,0)
        self.assertEqual(self.w('status','login')['current_stage'],'orient')
    def test_reflect_dependencies_are_rechecked_before_verify_and_finish(self):
        head=self.commit()
        self.start('Incident postmortem')
        self.w('skip','login','--reason','范围已确认，进入事故复盘')
        self.w('skip','login','--reason','诊断已在来源文档记录')
        (self.repo/'review.json').write_text(json.dumps({'standards':'pass','spec_fidelity':'not-applicable','head':head}),encoding='utf-8')
        self.w('record','login','review.json','--kind','review');self.w('advance','login')
        source=self.repo/'problem.md';source.write_text('实际复盘来源',encoding='utf-8')
        argv=[sys.executable,'-c','print("replay passed")']
        executed=subprocess.run(argv,cwd=self.repo,capture_output=True,text=True,check=True)
        output=self.repo/'replay.log';output.write_text(executed.stdout,encoding='utf-8')
        replay=self.repo/'replay.json'
        replay.write_text(json.dumps({'schema':'dairn.retro-replay.v1','status':'passed','trials':[{'argv':argv,'exit_code':executed.returncode,'output_path':'replay.log','output_sha256':hashlib.sha256(output.read_bytes()).hexdigest()}]}),encoding='utf-8')
        retro=self.repo/'retro.json'
        retro.write_text(json.dumps({'schema':'dairn.retro.v1','retro_id':'retro-test','task_id':'login','scope':{'repository':'org/repo','base_commit':head,'head_commit':head,'window':{'start':'2026-10-25T00:00:00Z','end':'2026-10-25T01:00:00Z'},'coverage':{'cli':'partial','harness':'unknown','ci':'unavailable'}},'status':'verified','findings':[{'id':'tooling-fix','status':'verified','category':'tooling','severity':'medium','observed':'真实启动失败','sources':[{'kind':'document','reference':'problem.md','sha256':hashlib.sha256(source.read_bytes()).hexdigest()}],'confidence':'observed','hypothesis':'入口未接线','resolution':{'kind':'tooling','action':'修复入口'},'verification_plan':{'method':'replay','fixture':'launcher','success_metric':'exit','target':'zero','guardrails':['保留必需检查']},'decision':{'status':'accepted','actor':'human','reference':'review'},'implementation':{'commit':head,'reference':'change'},'verification':{'replay':{'path':'replay.json','sha256':hashlib.sha256(replay.read_bytes()).hexdigest()}}}]}),encoding='utf-8')
        self.w('record','login','retro.json','--kind','retro')
        self.assertEqual(self.w('verify','login')['evidence_errors'],[])
        recorded=retro.read_bytes()
        for dependency in (source,replay,output):
            original=dependency.read_bytes()
            with self.subTest(dependency=dependency.name):
                dependency.write_text('记录后依赖被篡改',encoding='utf-8')
                verified=self.call('work','verify','login','--root',self.repo)
                self.assertNotEqual(verified.returncode,0,verified.stdout+verified.stderr)
                self.assertIn('reflect:',verified.stdout)
                self.assertNotEqual(self.call('work','finish','login','--root',self.repo).returncode,0)
                self.assertEqual(retro.read_bytes(),recorded)
                dependency.write_bytes(original)
        self.assertEqual(self.w('verify','login')['evidence_errors'],[])
        self.w('finish','login')
    def test_revise_archives_old_evidence_and_reopens_earliest_changed_stage(self):
        self.start()
        self.w('record','login','README.md','--kind','document')
        self.w('advance','login')
        ledger=self.repo/'.dairn/work/login.json'
        before=ledger.read_bytes()
        (self.repo/'README.md').write_text('修正后的规格来源',encoding='utf-8')
        self.assertNotEqual(self.call('work','verify','login','--root',self.repo).returncode,0)
        no_reason=self.call('work','revise','login','--stage','orient','--root',self.repo)
        self.assertNotEqual(no_reason.returncode,0)
        self.assertEqual(ledger.read_bytes(),before)
        revised=self.w('revise','login','--stage','orient','--reason','规格引用已修改，需要重新定位并验证后续阶段')
        self.assertEqual(revised['next']['id'],'orient')
        data=json.loads(ledger.read_text())
        archive=self.repo/data['stage_revisions'][-1]['path']
        self.assertEqual(archive.read_bytes(),before)
        self.assertEqual(data['stages'][0]['evidence'],[])
        self.assertTrue(all(s['status']=='pending' for s in data['stages'][1:]))
        self.w('record','login','README.md','--kind','document')
        self.w('advance','login')
        self.assertEqual(self.w('verify','login')['evidence_errors'],[])
        archive.write_text('篡改历史归档',encoding='utf-8')
        self.assertNotEqual(self.call('work','verify','login','--root',self.repo).returncode,0)
    def test_revise_can_explicitly_reclassify_without_claiming_checks_passed(self):
        self.start('Review PR')
        self.assertFalse(any(s['stage']=='implement' for s in self.w('next','login')['stages']))
        self.w('revise','login','--kind','change','--reason','任务包含代码实现，需要完整执行与证据阶段')
        status=self.w('next','login')
        self.assertTrue(any(s['stage']=='implement' for s in status['stages']))
        self.assertEqual(status['linked_runs'],[])
        self.assertEqual(status['current_stage'],'orient')
    def test_symlink_escape_refused(self):
        self.start();outside=Path(self.tmp.name)/'secret.md';outside.write_text('do not touch',encoding='utf-8')
        (self.repo/'outside.md').symlink_to(outside)
        self.assertNotEqual(self.call('work','record','login','outside.md','--kind','note','--root',self.repo).returncode,0)
        self.assertEqual(outside.read_text(encoding='utf-8'),'do not touch')
    def test_review_needs_two_independent_axes(self):
        self.start('Review login change')
        # workflow review = orient, review, synchronize
        self.w('record','login','README.md','--kind','document');self.w('advance','login')
        review=self.repo/'review.json';review.write_text(json.dumps({'standards':'pass','spec_fidelity':'pass'}),encoding='utf-8')
        self.assertNotEqual(self.call('work','record','login','review.json','--kind','review','--root',self.repo).returncode,0)
        head=self.commit()
        review.write_text(json.dumps({'standards':'pass','spec_fidelity':'not-applicable','head':head}),encoding='utf-8')
        self.w('record','login','review.json','--kind','review');self.w('advance','login')
        sync=self.repo/'sync.json';sync.write_text(json.dumps({'status':'no-change','head':head,'reviewed_docs':['README.md'],'reason':'Reviewed changed files and confirmed published guidance is still accurate.'}),encoding='utf-8')
        self.w('record','login','sync.json','--kind','document');self.w('finish','login')
        self.assertEqual(self.w('status','login')['status'],'recorded-complete')
    def test_failed_review_is_recorded_but_blocks_advance(self):
        self.start('Review login change')
        self.w('record','login','README.md','--kind','document');self.w('advance','login')
        head=self.commit()
        review=self.repo/'review-fail.json'
        review.write_text(json.dumps({'standards':'fail','spec_fidelity':'not-applicable','head':head}),encoding='utf-8')
        self.w('record','login','review-fail.json','--kind','review')
        blocked=self.call('work','advance','login','--root',self.repo)
        self.assertNotEqual(blocked.returncode,0)
        self.assertIn('standards or spec fidelity failed',blocked.stderr)
        fixed=self.repo/'review-pass.json'
        fixed.write_text(json.dumps({'standards':'pass','spec_fidelity':'not-applicable','head':head}),encoding='utf-8')
        self.w('record','login','review-pass.json','--kind','review')
        self.assertEqual(self.w('advance','login')['next']['id'],'synchronize')
    def test_review_with_spec_requires_real_document(self):
        self.start('Review login change')
        self.w('record','login','README.md','--kind','document');self.w('advance','login')
        review=self.repo/'review.json'
        review.write_text(json.dumps({'standards':'pass','spec_fidelity':'pass','spec_ref':'docs/specs/missing.md'}),encoding='utf-8')
        self.assertNotEqual(self.call('work','record','login','review.json','--kind','review','--root',self.repo).returncode,0)
        d=self.repo/'docs/specs';d.mkdir()
        (d/'auth.md').write_text('---\nid: project.auth\n---\n# Auth contract\n',encoding='utf-8')
        head=self.commit()
        review.write_text(json.dumps({'standards':'pass','spec_fidelity':'pass','spec_ref':'docs/specs/auth.md','head':head}),encoding='utf-8')
        self.w('record','login','review.json','--kind','review')
    def test_empty_evidence_is_refused(self):
        self.start();(self.repo/'empty.md').write_text('',encoding='utf-8')
        self.assertNotEqual(self.call('work','record','login','empty.md','--kind','note','--root',self.repo).returncode,0)
    def test_work_advance_last_stage_rejected(self):
        self.start('Docs update')  # orient synchronize
        head=self.commit()
        self.w('record','login','README.md','--kind','note');self.w('advance','login')
        sync=self.repo/'sync.json';sync.write_text(json.dumps({'status':'no-change','head':head,'reviewed_docs':['docs/PROJECT_GUIDE.md'],'reason':'No mismatch found while reviewing docs.'}),encoding='utf-8')
        self.w('record','login','sync.json','--kind','document')
        self.assertNotEqual(self.call('work','advance','login','--root',self.repo).returncode,0)
        self.w('finish','login')
    def test_guide_impact_initial_clean(self):
        report=self.obj('guide','impact','--root',self.repo)
        self.assertEqual(report['status'],'clean')
    def test_private_source_edit_is_informational(self):
        src=self.repo/'hello.go';src.write_text(src.read_text(encoding='utf-8')+'\nfunc internal() int { return 42 }\n',encoding='utf-8')
        rep=self.obj('guide','impact','--root',self.repo)
        self.assertEqual(rep['status'],'informational')
        self.assertIn('code-internal',[x['category'] for x in rep['impacts']])
        self.assertEqual(self.call('guide','impact','--strict','--root',self.repo).returncode,0)
    def test_public_signature_change_requires_review(self):
        src=self.repo/'hello.go';src.write_text(src.read_text(encoding='utf-8').replace('Greeting() string','Greeting(who string) string'),encoding='utf-8')
        rep=self.obj('guide','impact','--root',self.repo)
        self.assertEqual(rep['status'],'review-required')
        self.assertIn('public-surface',[x['category'] for x in rep['impacts']])
        self.assertIn('docs/PROJECT_GUIDE.md',{x['path'] for x in rep['affected_docs']})
        self.assertNotEqual(self.call('guide','impact','--strict','--root',self.repo).returncode,0)
    def test_import_change_is_detected(self):
        src=self.repo/'hello.go';src.write_text(src.read_text(encoding='utf-8')+'\nimport "fmt"\n',encoding='utf-8')
        rep=self.obj('guide','impact','--root',self.repo)
        self.assertIn('imports',[x['category'] for x in rep['impacts']])
    def test_spec_change_is_contract_impact(self):
        specs=self.repo/'docs/specs';specs.mkdir()
        (specs/'api.md').write_text('---\nid: project.api\n---\n# Contract\n',encoding='utf-8')
        rep=self.obj('guide','impact','--root',self.repo)
        self.assertEqual(rep['status'],'contract-impact')
    def test_trusted_base_overrides_laundered_snapshot(self):
        base=self.commit()
        (self.repo/'hello.go').write_text((self.repo/'hello.go').read_text(encoding='utf-8').replace('Greeting() string','Greeting(who string) string'),encoding='utf-8')
        self.ok('guide','facts','--apply','--root',self.repo)
        self.assertEqual(self.obj('guide','impact','--root',self.repo)['status'],'clean')
        rep=self.obj('guide','impact','--base',base,'--root',self.repo)
        self.assertEqual(rep['status'],'review-required')
        self.assertEqual(self.call('guide','impact','--strict','--base',base,'--root',self.repo).returncode,2)
    def test_import_graph_detects_downstream_module(self):
        other=Path(self.tmp.name)/'multi'
        for name in ('api','common'):
            d=other/name;d.mkdir(parents=True,exist_ok=True)
            (d/'go.mod').write_text('module example.com/'+name+'\n\ngo 1.20\n',encoding='utf-8')
        (other/'api/main.go').write_text('package main\nimport "example.com/common"\nfunc main() { _ = common.Greet() }\n',encoding='utf-8')
        (other/'common/main.go').write_text('package common\nfunc Greet() string { return "hello" }\n',encoding='utf-8')
        self.ok('adopt','--root',other)
        self.ok('guide','facts','--root',other,'--apply')
        (other/'common/main.go').write_text('package common\nfunc Greet(name string) string { return "hello" }\n',encoding='utf-8')
        report=self.obj('guide','impact','--root',other)
        self.assertEqual(report['status'],'review-required')
        self.assertTrue(any(x['from']=='api' and x['to']=='common' for x in report['graph']['edges']),report['graph'])
        self.assertIn('api',report['downstream_modules'])

class PythonBaseline(unittest.TestCase):
    """只依赖当前 Python 标准库的真实检查和分发产物实测。"""

    def test_validate_and_real_python_baseline(self):
        with tempfile.TemporaryDirectory(prefix='dairn-python-baseline-') as directory:
            workspace=Path(directory).resolve()
            repo=workspace/'service'
            env={**os.environ,'GIT_CEILING_DIRECTORIES':str(workspace.parent),
                 'TMPDIR':str(workspace),'TEMP':str(workspace),'TMP':str(workspace),
                 'DAIRN_CACHE_HOME':str(workspace/'runtime-cache')}

            def call(*args):
                return subprocess.run([str(CLI),*map(str,args),'--root',str(repo)],
                    cwd=workspace,env=env,text=True,capture_output=True,
                    encoding='utf-8',errors='replace',timeout=120)

            initialized=call('init','--name','python_baseline','--stack','python','--ci','none')
            self.assertEqual(initialized.returncode,0,initialized.stdout+initialized.stderr)
            for name in ('app','tests','integration'):
                (repo/name).mkdir(exist_ok=True)
            (repo/'app/__init__.py').write_text('',encoding='utf-8')
            source=repo/'app/calculator.py'
            source.write_text('import sys\n\ndef add(a,b):\n    return a+b\n\n'
                'def main():\n    a,b=map(int,sys.argv[1:])\n    print(add(a,b))\n\n'
                'if __name__=="__main__":\n    main()\n',encoding='utf-8')
            (repo/'tests/test_calculator.py').write_text(
                'import unittest\nfrom app.calculator import add\n\n'
                'class Addition(unittest.TestCase):\n'
                '    def test_add(self):\n        self.assertEqual(add(2,3),5)\n',encoding='utf-8')
            (repo/'integration/test_cli.py').write_text(
                'import subprocess,sys,unittest\n\n'
                'class CommandLine(unittest.TestCase):\n'
                '    def test_cli(self):\n'
                '        result=subprocess.run([sys.executable,"-m","app.calculator","6","7"],capture_output=True,text=True)\n'
                '        self.assertEqual(result.returncode,0,result.stderr)\n'
                '        self.assertEqual(result.stdout.strip(),"13")\n',encoding='utf-8')
            commands={
                'lint':[sys.executable,'-m','compileall','-q','app','tests','integration'],
                'unit':[sys.executable,'-m','unittest','discover','-s','tests','-v'],
                'integration':[sys.executable,'-m','unittest','discover','-s','integration','-v'],
                'build':[sys.executable,'-m','zipapp','app','--main','calculator:main','--output','application.pyz'],
            }
            policy_path=repo/'.dairn/governance/project.json'
            policy=json.loads(policy_path.read_text(encoding='utf-8'))
            policy['modules'][0]['checks']={key:{'argv':argv,'cwd':'.'} for key,argv in commands.items()}
            policy_path.write_text(json.dumps(policy,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
            validated=call('validate')
            self.assertEqual(validated.returncode,0,validated.stdout+validated.stderr)

            def run_checks(label):
                before=set((repo/'.dairn/governance/evidence').glob('execution-*.json'))
                result=call('check','--all')
                created=set((repo/'.dairn/governance/evidence').glob('execution-*.json'))-before
                self.assertEqual(len(created),1,result.stdout+result.stderr)
                evidence=created.pop()
                output_dir=os.environ.get('DAIRN_TEST_EVIDENCE_DIR')
                if output_dir:
                    output=Path(output_dir)
                    output.mkdir(parents=True,exist_ok=True)
                    suffix='' if label=='passed' else '-failed'
                    (output/('linux-python-checks'+suffix+'.log')).write_text(result.stdout+'\n'+result.stderr,encoding='utf-8')
                    (output/('linux-python-checks'+suffix+'.json')).write_bytes(evidence.read_bytes())
                return result,json.loads(evidence.read_text(encoding='utf-8'))

            result,data=run_checks('passed')
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertEqual(data['schema'],'dairn.execution-record.v1')
            self.assertEqual(data['status'],'passed')
            checks={c['id']:c for c in data['checks']}
            self.assertEqual(set(checks),set(commands))
            for key,check in checks.items():
                self.assertEqual(check['argv'],commands[key])
                self.assertEqual(check['status'],'passed')
                self.assertEqual(check['exit_code'],0)
                self.assertFalse(check['timed_out'])
            packaged=subprocess.run([sys.executable,str(repo/'application.pyz'),'6','7'],
                cwd=repo,env=env,capture_output=True,text=True,timeout=20)
            self.assertEqual((packaged.returncode,packaged.stdout.strip()),(0,'13'),packaged.stderr)
            if os.environ.get('DAIRN_TEST_EVIDENCE_DIR'):
                (Path(os.environ['DAIRN_TEST_EVIDENCE_DIR'])/'linux-python-package.log').write_text(
                    packaged.stdout+packaged.stderr,encoding='utf-8')

            # 同时改变文件长度，避免同秒写入被 CPython 时间戳缓存误判为旧版本。
            source.write_text(source.read_text(encoding='utf-8').replace('return a+b','return a-b+100'),encoding='utf-8')
            failed,negative=run_checks('failed')
            self.assertNotEqual(failed.returncode,0,failed.stdout+failed.stderr)
            self.assertEqual(negative['status'],'failed')
            failed_checks={c['id']:c for c in negative['checks']}
            for name in ('unit','integration'):
                self.assertEqual(failed_checks[name]['status'],'failed')
                self.assertNotEqual(failed_checks[name]['exit_code'],0)


if __name__=='__main__':unittest.main()
