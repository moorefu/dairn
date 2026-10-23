"""Dairn self-contained native CLI acceptance suite (Python is test runner ONLY)."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/'dairn.sh'

class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dairn-lifecycle-')
        self.root=Path(self.tmp.name)/'project'
    def tearDown(self): self.tmp.cleanup()
    def runcli(self,*argv,env=None):
        return subprocess.run([str(CLI),*map(str,argv)],cwd=self.tmp.name,env=env,capture_output=True,text=True)
    def ok(self,*args,env=None):
        p=self.runcli(*args,env=env)
        self.assertEqual(p.returncode,0,p.stdout+'\n'+p.stderr)
        return p
    def initgo(self): self.ok('init','--path',self.root,'--stack','go','--sample')
    def test_version_and_spec_search(self):
        self.assertIn('Cosmopolitan QuickJS',self.ok('version').stdout)
        self.assertIn('dairn.governance.risk',self.ok('docs','find','risk').stdout)
        self.assertIn('id: dairn.governance.risk',self.ok('docs','show','dairn.governance.risk').stdout)
    def test_init_plan_does_not_write(self):
        self.ok('init','--path',self.root,'--stack','go','--plan')
        self.assertFalse(self.root.exists())
    def test_go_init_validate_and_real_l2(self):
        self.initgo()
        self.assertEqual(json.loads((self.root/'.dairn/lock.json').read_text())['schema'],2)
        self.ok('doctor','--root',self.root)
        self.ok('validate','--root',self.root)
        self.ok('check','--root',self.root,'--all')
        # No git repository here: the execution audit record (not a v1 run) is written.
        e=json.loads(sorted((self.root/'.dairn/governance/evidence').glob('execution-*.json'))[-1].read_text())
        self.assertEqual(e['schema'],'dairn.execution-record.v1')
        self.assertEqual(len(e['checks']),4)
        self.assertEqual({c['status'] for c in e['checks']},{'passed'})
    def test_auto_detect_multi_stack(self):
        (self.root/'service').mkdir(parents=True)
        (self.root/'frontend').mkdir()
        (self.root/'data').mkdir()
        (self.root/'service/go.mod').write_text('module example.com/s\n')
        (self.root/'frontend/package.json').write_text('{"dependencies":{"vue":"3.5"}}')
        (self.root/'data/pyproject.toml').write_text('[project]\nname="hello"\nversion="0.1"\n')
        data=json.loads(self.ok('detect','--root',self.root).stdout)
        self.assertEqual({x['stack'] for x in data},{'go','vue','python'})
        self.ok('adopt','--root',self.root,'--plan')
        self.assertFalse((self.root/'.dairn').exists())
    def test_adopt_preserves_foreign_files(self):
        self.root.mkdir();(self.root/'go.mod').write_text('module example.com/e\n')
        agent='# Team instructions\nNever deploy from PR.\n';readme='# Original README\n';make='all:\n\t@echo original\n'
        (self.root/'AGENTS.md').write_text(agent)
        (self.root/'README.md').write_text(readme)
        (self.root/'Makefile').write_text(make)
        self.ok('adopt','--root',self.root,'--plan')
        self.assertFalse((self.root/'.dairn').exists())
        self.ok('adopt','--root',self.root)
        self.assertIn(agent,(self.root/'AGENTS.md').read_text())
        self.assertEqual(readme,(self.root/'README.md').read_text())
        self.assertEqual(make,(self.root/'Makefile').read_text())
        self.ok('validate','--root',self.root)
        self.ok('upgrade','--root',self.root,'--plan')
        self.ok('upgrade','--root',self.root,'--apply')
    def test_no_overwrite_foreign_conflict(self):
        self.root.mkdir();(self.root/'go.mod').write_text('module e\n')
        (self.root/'docs').mkdir();(self.root/'docs/GOVERNANCE_SPEC.md').write_text('MY POLICY\n')
        before=(self.root/'docs/GOVERNANCE_SPEC.md').read_bytes()
        p=self.runcli('adopt','--root',self.root)
        self.assertNotEqual(p.returncode,0)
        self.assertEqual(before,(self.root/'docs/GOVERNANCE_SPEC.md').read_bytes())
        self.assertFalse((self.root/'.dairn/lock.json').exists())
        self.assertFalse((self.root/'AGENTS.md').exists())
    def test_upgrade_conflict_and_tamper_block(self):
        self.initgo()
        lock=self.root/'.dairn/lock.json';before=lock.read_bytes()
        skill=self.root/'.agents/skills/dairn-code-review/SKILL.md'
        skill.write_text(skill.read_text()+'\n## injected edits\n')
        self.assertNotEqual(self.runcli('validate','--root',self.root).returncode,0)
        p=self.runcli('upgrade','--root',self.root,'--apply')
        self.assertNotEqual(p.returncode,0)
        self.assertEqual(before,lock.read_bytes())
    def test_user_agent_notes_outside_managed_block_can_change(self):
        self.initgo()
        p=self.root/'AGENTS.md';p.write_text(p.read_text()+'\n## Team directives\nOwn instructions are okay.\n')
        self.ok('validate','--root',self.root)
    def test_skills_add_plan_and_apply(self):
        self.initgo()
        skill=self.root/'.agents/skills/dairn-domain-model/SKILL.md'
        self.ok('skills','add','dairn-domain-model','--root',self.root,'--plan')
        self.assertFalse(skill.exists())
        self.ok('skills','add','dairn-domain-model','--root',self.root,'--apply')
        self.assertTrue(skill.exists())
        self.ok('validate','--root',self.root)
    def test_ci_policy_pin_fails_closed(self):
        self.initgo()
        env={**os.environ,'GITLAB_CI':'true','CI_PIPELINE_SOURCE':'push'}
        self.assertNotEqual(self.runcli('check','--all','--root',self.root,env=env).returncode,0)
        cfg=(self.root/'.dairn/governance/project.json').read_bytes()
        env['DAIRN_EXPECTED_POLICY_SHA256']=hashlib.sha256(cfg).hexdigest()
        self.ok('check','--all','--root',self.root,env=env)
    def test_git_auth_change_l2(self):
        self.initgo()
        def git(*args):return subprocess.run(['git',*args],cwd=self.root,check=True,capture_output=True,text=True).stdout.strip()
        git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Tester')
        git('add','.');git('commit','-qm','initial')
        base=git('rev-parse','HEAD')
        (self.root/'auth.go').write_text('package hello\n\nfunc Authorize() bool {\n\treturn true\n}\n')
        (self.root/'auth_test.go').write_text('package hello\n\nimport "testing"\n\nfunc TestAuthorize(t *testing.T) {\n\tif !Authorize() {\n\t\tt.Fatal("failed")\n\t}\n}\n')
        git('add','.');git('commit','-qm','auth code')
        scope=json.loads(self.ok('scope','--root',self.root,'--base',base).stdout)
        self.assertEqual((scope['risk'],scope['governance_mode']),('L2','G2'))
        self.ok('check','--root',self.root,'--base',base)
        evidence=sorted((self.root/'.dairn/governance/evidence/runs').glob('*/*/run.json'))
        self.assertEqual(len(evidence),1)
        info=json.loads(evidence[0].read_text());self.assertEqual({r['status'] for r in info['checks']},{'passed'})
    def test_ci_generator_opt_in(self):
        self.ok('init','--path',self.root,'--stack','go','--ci','both')
        github=(self.root/'.github/workflows/dairn.yml').read_text()
        gitlab=(self.root/'.gitlab-ci.yml').read_text()
        self.assertIn('DAIRN_EXPECTED_POLICY_SHA256',github)
        self.assertIn('DAIRN_EXPECTED_POLICY_SHA256',gitlab)
    def test_notes_layout_symlink_cannot_escape(self):
        foreign=Path(self.tmp.name)/'foreign-notes';foreign.mkdir()
        self.root.mkdir();(self.root/'go.mod').write_text('module e\n')
        (self.root/'.agents/notes').mkdir(parents=True)
        (self.root/'.agents/notes/proposed').symlink_to(foreign,target_is_directory=True)
        self.assertNotEqual(self.runcli('adopt','--root',self.root).returncode,0)
        self.assertEqual(list(foreign.iterdir()),[])
        self.assertFalse((self.root/'.dairn/lock.json').exists())
    def test_symlink_target_not_written(self):
        other=Path(self.tmp.name)/'foreign';other.mkdir();self.root.mkdir()
        (self.root/'go.mod').write_text('module e\n')
        (self.root/'docs').symlink_to(other,target_is_directory=True)
        self.assertNotEqual(self.runcli('adopt','--root',self.root).returncode,0)
        self.assertEqual(list(other.iterdir()),[])
        self.assertFalse((self.root/'.dairn/lock.json').exists())

if __name__=='__main__': unittest.main()
