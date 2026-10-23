"""Official Cosmo QuickJS integration: project stubs and external Ed25519 CI evidence."""
import json,os,subprocess,tempfile,time,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/'dairn.sh'
class StubCIReview(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory(prefix='dairn-v12-');self.addCleanup(self.t.cleanup)
  self.dir=Path(self.t.name);self.project=self.dir/'project'
  self.call('init','--path',self.project,'--stack','go','--sample',ok=True)
  self.git('init','-q');self.git('config','user.email','tester@example.test');self.git('config','user.name','tester')
  # v1 subject 的 repository 从 remote 推导；CI 上下文绑定要求两者一致。
  self.git('remote','add','origin','https://github.com/sample/project.git')
 def call(self,*args,env=None,ok=False):
  proc=subprocess.run([str(CLI),*map(str,args)],cwd=self.dir,env={**os.environ,**(env or {})},capture_output=True,text=True,timeout=150)
  if ok:self.assertEqual(proc.returncode,0,proc.stdout+'\n'+proc.stderr)
  return proc
 def obj(self,*args,env=None):return json.loads(self.call(*args,'--root',self.project,env=env,ok=True).stdout)
 def git(self,*args):return subprocess.run(['git',*args],cwd=self.project,capture_output=True,text=True,check=True).stdout.strip()
 def base(self):self.git('add','.');self.git('commit','-qm','baseline');return self.git('rev-parse','HEAD')
 def runtime_sha(self):
  import hashlib
  return hashlib.sha256((ROOT/'runtime/dairn-embedded.com').read_bytes()).hexdigest()
 def engine_version(self):
  # CLI 版本来自内嵌运行时 manifest；标签构建会覆盖 package.json 的兜底版本。
  return json.loads((ROOT/'runtime/runtime-integrity.json').read_text(encoding='utf-8'))['engine_version']
 def fast_env(self,cache,extra=None):
  # 快速缓存用例显式清空受保护 CI 标记；负例再单独设置。
  return {'GITHUB_ACTIONS':'','GITLAB_CI':'','DAIRN_PROTECTED_CI':'',
          'DAIRN_FAST_RUNTIME':'1','DAIRN_CACHE_HOME':str(cache),**(extra or {})}
 def fast_store(self,cache):return cache/('native-'+self.runtime_sha())
 def assert_fast_cache_valid(self,cache):
  import hashlib
  store=self.fast_store(cache);native=store/'dairn-native';meta=store/'dairn-native.sha256'
  self.assertTrue(native.is_file());self.assertTrue(meta.is_file())
  self.assertFalse(native.is_symlink());self.assertFalse(meta.is_symlink())
  self.assertEqual(sorted(p.name for p in store.iterdir()),['dairn-native','dairn-native.sha256'])
  self.assertEqual(hashlib.sha256(native.read_bytes()).hexdigest(),meta.read_text(encoding='utf-8').strip())
  self.assertFalse((store/'.dairn-native.lock').exists())
  self.assertFalse(list(store.glob('*.tmp')))
  return native,meta
 def task(self):
  self.obj('work','start','Implement authentication feature','--id','auth')
  (self.project/'grill.json').write_text(json.dumps({'schema':1,'task_id':'auth','questions':[
   {'id':'q1','prompt':'Which token lifetime fits the threat model?',
    'recommendation':'Short-lived signed token','status':'resolved',
    'decision':'Short-lived signed token, rotated on login'}]})+'\n')
  for path,kind in [('README.md','note'),('grill.json','grill'),('README.md','spec'),('README.md','note')]:
   self.obj('work','record','auth',path,'--kind',kind)
   self.obj('work','advance','auth')
 def change(self):
  f=self.project/'auth.go';f.write_text('package hello\n\nfunc VerifyToken(s string) bool {\n\treturn len(s) > 0\n}\n');self.git('add','auth.go');self.git('commit','-qm','new auth')
 def signkeys(self):
  priv=self.dir/'ci-key.pem';pub=self.dir/'ci-pub.pem';wrong=self.dir/'wrong-pub.pem';p2=self.dir/'wrong.pem'
  subprocess.run(['openssl','genpkey','-algorithm','ED25519','-out',str(priv)],check=True,capture_output=True)
  subprocess.run(['openssl','pkey','-in',str(priv),'-pubout','-out',str(pub)],check=True,capture_output=True)
  subprocess.run(['openssl','genpkey','-algorithm','ED25519','-out',str(p2)],check=True,capture_output=True)
  subprocess.run(['openssl','pkey','-in',str(p2),'-pubout','-out',str(wrong)],check=True,capture_output=True)
  return priv,pub,wrong
 def test_new_project_agent_compat_and_gitignore(self):
  self.assertTrue((self.project/'CLAUDE.md').exists());self.assertTrue((self.project/'AGENTS.md').exists());self.assertTrue((self.project/'.agents/skills/dairn-agent-workflow/SKILL.md').exists());self.assertTrue((self.project/'.dairn/stubs.json').exists())
  self.assertIn('.dairn/cache/',(self.project/'.gitignore').read_text())
  self.call('validate','--root',self.project,ok=True)
 def test_stub_fail_closed_without_config(self):
  self.assertNotEqual(self.call('guide','impact','--precision','surface','--root',self.project).returncode,0)
 def test_stub_go_ast_and_dirty_cache(self):
  source=ROOT/'examples/stubs/go-surface/main.go'
  f=self.project/'.dairn/stubs.json';f.write_text(json.dumps({'schema':1,'stubs':[{'id':'surface','kind':'surface-analysis','argv':['go','run',str(source)],'cwd':'.','timeout_seconds':120}]})+'\n')
  base=self.base();self.change()
  res=self.obj('guide','impact','--base',base,'--precision','surface')
  self.assertEqual(res['stub_analysis']['source'],'project-stub');self.assertTrue(any(x['symbol']=='func:VerifyToken' for x in res['stub_analysis']['changes']))
  again=self.obj('guide','impact','--base',base,'--precision','surface')
  self.assertEqual(again['stub_analysis']['source'],'local-cache')
  (self.project/'README.md').write_text('uncommitted edit\n')
  changed=self.obj('guide','impact','--base',base,'--precision','surface');self.assertEqual(changed['stub_analysis']['source'],'project-stub')
  self.assertEqual(list((self.project/'.dairn/cache/stubs').glob('req-*')),[])
 def test_stub_error_returns_nonzero(self):
  f=self.project/'.dairn/stubs.json';f.write_text(json.dumps({'schema':1,'stubs':[{'id':'surface','kind':'surface-analysis','argv':['git','does-not-exist'],'cwd':'.'}]}))
  self.base()
  self.assertNotEqual(self.call('guide','impact','--precision','surface','--root',self.project).returncode,0)
 def test_external_signed_attestation_review_and_synchronize(self):
  self.task();base=self.base();self.change();head=self.git('rev-parse','HEAD')
  check=self.call('check','--base',base,'--task','auth','--root',self.project,ok=True)
  run_id=next(line.split()[-2] for line in check.stdout.splitlines() if line.startswith('Linked task run'))
  self.obj('work','advance','auth')
  # Standalone evidence: bundle the run, prepare a v1 statement, sign externally, verify.
  self.call('evidence','bundle','--run',run_id,
            '--out','.dairn/governance/evidence/bundle.json','--root',self.project,ok=True)
  context=self.project/'.dairn/governance/evidence/ci-context.json'
  context.write_text(json.dumps({'provider':'gitlab','repository':'sample/project','workflow_ref':'refs/heads/main',
   'pipeline_id':'200','build_job_id':'100','source_commit':head,'event':'push'}))
  prep=self.call('attest','prepare','--bundle','.dairn/governance/evidence/bundle.json',
   '--context','.dairn/governance/evidence/ci-context.json','--out','.dairn/governance/evidence/statement.json','--root',self.project,ok=True)
  payload=self.project/'.dairn/governance/evidence/statement.json';sig=self.project/(str(payload)+'.sig')
  priv,pub,wrong=self.signkeys()
  subprocess.run(['openssl','pkeyutl','-sign','-inkey',str(priv),'-rawin','-in',str(payload),'-out',str(sig)],check=True,capture_output=True)
  verify=lambda key,commit=head: self.call('attest','verify','--statement','.dairn/governance/evidence/statement.json',
   '--signature','.dairn/governance/evidence/statement.json.sig','--key',str(key),'--context','.dairn/governance/evidence/ci-context.json','--root',self.project)
  self.assertNotEqual(verify(wrong).returncode,0)
  ok_verify=verify(pub);self.assertEqual(ok_verify.returncode,0,ok_verify.stdout+'\n'+ok_verify.stderr)
  # Gate composition (v1 protocol inputs). Post-merge trusts the signed build
  # chain (approval was enforced pre-merge by the platform); pre-merge without
  # approval evidence stays INDETERMINATE, never a silent pass. The gate binds
  # the verified statement to THIS run id, so the fixture reuses the real one.
  self.subject_file(head)
  v1run=self.v1_run_file(head,run_id)
  gate=lambda stage='post-merge',key=None: self.call('gate','evaluate','--subject','.dairn/governance/evidence/subject.json',
   '--policy','.dairn/governance/project.json','--check',v1run,
   '--attestation','.dairn/governance/evidence/statement.json',
   '--signature','.dairn/governance/evidence/statement.json.sig','--key',str(key or pub),
   '--context','.dairn/governance/evidence/ci-context.json',
   '--stage',stage,'--root',self.project)
  self.assertEqual(gate().returncode,0)
  self.assertEqual(gate('pre-merge').returncode,3)
  # Wrong public key: real Ed25519 verification fails closed, never PASS.
  self.assertEqual(gate(key=wrong).returncode,1)
  # Review requires explicit, current-head two-axis decision.
  review=self.project/'review.json'
  review.write_text(json.dumps({'standards':'pass','spec_fidelity':'not-applicable','head':'0'*40}))
  self.assertNotEqual(self.call('work','record','auth','review.json','--kind','review','--root',self.project).returncode,0)
  review.write_text(json.dumps({'standards':'pass','spec_fidelity':'not-applicable','head':head}))
  self.obj('work','record','auth','review.json','--kind','review')
  self.call('work','advance','auth','--root',self.project,ok=True)
  self.assertEqual(self.obj('work','next','auth')['current_stage'],'synchronize')
  sync=self.project/'sync.json';sync.write_text(json.dumps({'status':'no-change','head':head,'reviewed_docs':['README.md'],'reason':'No user-facing documentation or published interface guidance changed in this patch.'}))
  self.obj('work','record','auth','sync.json','--kind','document')
  self.call('work','finish','auth','--root',self.project,ok=True)
  # Tamper the signed statement: verification must fail afterwards.
  payload.write_text(payload.read_text().replace('"pipeline_id":"200"','"pipeline_id":"999"'))
  self.assertNotEqual(verify(pub).returncode,0)
 def subject_file(self,commit):
  path=self.project/'.dairn/governance/evidence/subject.json'
  tree=self.git('rev-parse','HEAD^{tree}')
  path.write_text(json.dumps({'schema':'dairn.subject.v1','repository':'sample/project','kind':'git-commit',
   'source_commit':commit,'tree_sha':tree,'base_commit':None,'comparison':'base-to-source'}))
  return '.dairn/governance/evidence/subject.json'
 def v1_run_file(self,commit,run_id='run-gatefixture-0001'):
  tree=self.git('rev-parse','HEAD^{tree}')
  path=self.project/'.dairn/governance/evidence/gate-check.json'
  # Full L2 matrix for the sample project's single module (gate enforces
  # (module, check) coverage and binds the attestation to this exact run).
  checks=[{'id':g,'module':'app','status':'passed','exit_code':0} for g in ('lint','unit','integration','build')]
  path.write_text(json.dumps({'schema':'dairn.check-run.v1','run_id':run_id,
   'subject':{'schema':'dairn.subject.v1','repository':'sample/project','kind':'git-commit',
    'source_commit':commit,'tree_sha':tree,'base_commit':None,'comparison':'base-to-source'},
   'execution':{'environment':'local','policy_sha256':'0'*64},
   'required_checks':['lint','unit','integration','build'],'checks':checks,
   'status':'passed','declared_assurance':'local-observed','related_tasks':[]}))
  return '.dairn/governance/evidence/gate-check.json'
 def test_ci_stub_requires_external_hash(self):
  f=self.project/'.dairn/stubs.json';source=ROOT/'examples/stubs/go-surface/main.go'
  f.write_text(json.dumps({'schema':1,'stubs':[{'id':'surface','kind':'surface-analysis','argv':['go','run',str(source)],'cwd':'.'}]}))
  base=self.base();self.change();env={'GITLAB_CI':'true'}
  self.assertNotEqual(self.call('guide','impact','--base',base,'--precision','surface','--root',self.project,env=env).returncode,0)
  import hashlib
  env['DAIRN_EXPECTED_STUBS_SHA256']=hashlib.sha256(f.read_bytes()).hexdigest()
  res=self.obj('guide','impact','--base',base,'--precision','surface',env=env)
  self.assertTrue(res['stub_analysis']['changes'])
 def test_ape_fast_cache_does_not_mutate_source(self):
  original=self.runtime_sha();cache=self.dir/'runtime-cache'
  p=self.call('version',env=self.fast_env(cache),ok=True)
  version=self.engine_version()
  self.assertIn('Dairn '+version+' —',p.stdout)
  self.assert_fast_cache_valid(cache)
  self.assertEqual(self.runtime_sha(),original)
 def test_plain_ci_true_still_uses_fast_cache(self):
  cache=self.dir/'plain-ci-cache';env=self.fast_env(cache,{'CI':'true'})
  self.call('version',env=env,ok=True)
  native,_=self.assert_fast_cache_valid(cache)
  before=(native.read_bytes(),native.stat().st_mtime_ns)
  self.call('version',env=env,ok=True)
  self.assertEqual((native.read_bytes(),native.stat().st_mtime_ns),before,'仅 CI=true 时快速缓存仍应命中复用')
 def test_fast_cache_disabled_on_protected_ci(self):
  original=self.runtime_sha()
  version=self.engine_version()
  cases=[('GITHUB_ACTIONS','true'),('GITHUB_ACTIONS','1'),('GITLAB_CI','true'),('DAIRN_PROTECTED_CI','1')]
  for index,(name,value) in enumerate(cases):
   with self.subTest(name+'='+value):
    cache=self.dir/('protected-cache-'+str(index))
    p=self.call('version',env=self.fast_env(cache,{name:value}),ok=True)
    self.assertIn('Dairn '+version+' —',p.stdout)
    self.assertFalse(cache.exists(),name+'='+value+' 下不得创建快速缓存')
  self.assertEqual(self.runtime_sha(),original)
 def test_fast_cache_self_heals_tampered_artifact(self):
  original=self.runtime_sha();cache=self.dir/'heal-cache';env=self.fast_env(cache)
  self.call('version',env=env,ok=True);native,_=self.assert_fast_cache_valid(cache)
  marker=self.dir/'tampered-cache-was-executed'
  native.write_text('#!/bin/sh\ntouch "'+str(marker)+'"\nexit 42\n',encoding='utf-8');native.chmod(0o700)
  self.call('version',env=env,ok=True)
  self.assertFalse(marker.exists(),'不得执行摘要校验失败的缓存文件')
  self.assert_fast_cache_valid(cache)
  self.assertEqual(self.runtime_sha(),original)
 def test_fast_cache_recovers_from_stale_lock(self):
  cache_home=self.dir/'stale-lock-cache';env=self.fast_env(cache_home)
  store=self.fast_store(cache_home);store.mkdir(parents=True)
  lock=store/'.dairn-native.lock';lock.mkdir();old=time.time()-15*60;os.utime(lock,(old,old))
  self.call('version',env=env,ok=True)
  self.assert_fast_cache_valid(cache_home)
  self.assertFalse(lock.exists(),'陈旧锁必须被清理')
 def test_fast_cache_concurrent_launches(self):
  cache_home=self.dir/'concurrent-cache';env={**os.environ,**self.fast_env(cache_home)}
  procs=[subprocess.Popen([str(CLI),'version'],cwd=self.dir,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in range(2)]
  outputs=[proc.communicate(timeout=150) for proc in procs]
  for proc,(out,err) in zip(procs,outputs):self.assertEqual(proc.returncode,0,out+'\n'+err)
  self.assertEqual(outputs[0][0],outputs[1][0])
  self.assert_fast_cache_valid(cache_home)
 def test_adopt_existing_claude_instructions_preserved(self):
  other=self.dir/'existing';other.mkdir();(other/'CLAUDE.md').write_text('Custom team Claude instructions.\n')
  (other/'go.mod').write_text('module example.com/test\n\ngo 1.20\n')
  self.call('adopt','--root',other,ok=True)
  self.assertEqual((other/'CLAUDE.md').read_text(),'Custom team Claude instructions.\n')
 def test_review_decision_rejected_after_new_head(self):
  self.obj('work','start','Review existing changes','--id','inspect')
  head=self.base()
  self.obj('work','record','inspect','README.md','--kind','note')
  self.obj('work','advance','inspect')
  review=self.project/'review.json';review.write_text(json.dumps({'standards':'pass','spec_fidelity':'not-applicable','head':head}))
  self.obj('work','record','inspect','review.json','--kind','review')
  (self.project/'new.md').write_text('new commit\n');self.git('add','new.md');self.git('commit','-qm','head moved')
  self.assertNotEqual(self.call('work','verify','inspect','--root',self.project).returncode,0)
  self.assertNotEqual(self.call('work','advance','inspect','--root',self.project).returncode,0)
 def test_malformed_stub_blocks_governance(self):
  (self.project/'.dairn/stubs.json').write_text('\u007b"schema":1,"stubs":[{"id":"foo","kind":"missing","argv":["true"]}]}')
  self.assertNotEqual(self.call('validate','--root',self.project).returncode,0)
 def test_review_missing_and_synchronize_unstructured(self):
  self.task();base=self.base();self.change();self.call('check','--base',base,'--task','auth','--root',self.project,ok=True);self.obj('work','advance','auth')
  self.assertNotEqual(self.call('work','advance','auth','--root',self.project).returncode,0)
  head=self.git('rev-parse','HEAD');p=self.project/'review.json';p.write_text(json.dumps({'standards':'pass','spec_fidelity':'not-applicable','head':head}))
  self.obj('work','record','auth','review.json','--kind','review');self.obj('work','advance','auth')
  self.assertNotEqual(self.call('work','record','auth','README.md','--kind','document','--root',self.project).returncode,0)
  self.assertNotEqual(self.call('work','finish','auth','--root',self.project).returncode,0)
if __name__=='__main__':unittest.main(verbosity=2)
