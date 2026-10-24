"""原生 QuickJS 工作和影响分析集成测试。"""
from pathlib import Path
import json, os, subprocess, tempfile, unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/('dairn.cmd' if os.name=='nt' else 'dairn.sh')
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
    def test_validate_and_real_go_baseline(self):
        self.ok('validate','--root',self.repo)
        result=self.call('check','--all','--root',self.repo)
        # Not a git repository: an execution audit record (not a v1 run) is written.
        records=sorted((self.repo/'.dairn/governance/evidence').glob('execution-*.json'))
        evidence=records[-1]
        output_dir=os.environ.get('DAIRN_TEST_EVIDENCE_DIR')
        if output_dir:
            output=Path(output_dir)
            output.mkdir(parents=True,exist_ok=True)
            (output/'linux-go-checks.log').write_text(result.stdout+'\n'+result.stderr,encoding='utf-8')
            (output/'linux-go-checks.json').write_bytes(evidence.read_bytes())
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        data=json.loads(evidence.read_text(encoding='utf-8'))
        self.assertEqual(data['schema'],'dairn.execution-record.v1')
        self.assertEqual(data['status'],'passed')
        checks={c['id']:c for c in data['checks']}
        self.assertEqual(set(checks),{'lint','unit','integration','build'})
        for check in checks.values():
            self.assertEqual(check['status'],'passed')
            self.assertEqual(check['exit_code'],0)
            self.assertFalse(check['timed_out'])
        self.assertEqual(checks['integration']['argv'],['go','test','./...'])

if __name__=='__main__':unittest.main()
