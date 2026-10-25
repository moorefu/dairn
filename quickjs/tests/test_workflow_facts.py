"""Native QuickJS facts, drift, workflow and renamed Skill regression."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/'dairn'

class GuidanceFacts(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dairn-v09-facts-')
        self.root=Path(self.tmp.name)/'repo'
    def tearDown(self):self.tmp.cleanup()
    def call(self,*args):return subprocess.run([str(CLI),*map(str,args)],capture_output=True,text=True,cwd=self.tmp.name)
    def ok(self,*args):
        result=self.call(*args)
        self.assertEqual(result.returncode,0, result.stdout+'\n'+result.stderr)
        return result
    def go(self):self.ok('init','--path',self.root,'--stack','go','--sample')
    def report(self):return json.loads(self.ok('guide','drift','--root',self.root).stdout)
    def test_initial_snapshot_clean_and_skill_prefix(self):
        self.go()
        self.assertEqual(self.report()['status'],'clean')
        self.assertTrue((self.root/'.dairn/facts/project-facts.json').is_file())
        self.assertTrue((self.root/'.agents/skills/dairn-project-guidance/SKILL.md').is_file())
        names=[x.name for x in (self.root/'.agents/skills').iterdir()]
        self.assertTrue(all(n.startswith('dairn-') for n in names),names)
        self.ok('guide','audit','--root',self.root,'--strict')
    def test_dependency_change_maps_docs_and_never_autoresets(self):
        self.go()
        snap=self.root/'.dairn/facts/project-facts.json';before=snap.read_bytes()
        with (self.root/'go.mod').open('a') as f:f.write('\nrequire example.com/verify v1.2.3\n')
        rep=self.report();self.assertEqual(rep['status'],'drift')
        self.assertTrue(any(c['category']=='dependencies' for c in rep['changes']))
        self.assertIn('README.md',{x['path'] for x in rep['affected_docs']})
        self.assertEqual(snap.read_bytes(),before)
        self.assertNotEqual(self.call('guide','drift','--strict','--root',self.root).returncode,0)
        self.ok('validate','--root',self.root) # advisory, no accidental process blockage
        self.assertEqual(snap.read_bytes(),before)
        self.ok('guide','facts','--root',self.root,'--apply')
        self.assertEqual(self.report()['status'],'clean')
    def test_observed_module_and_entrypoint_change(self):
        self.go()
        (self.root/'new-service').mkdir()
        (self.root/'new-service/Cargo.toml').write_text('[package]\nname="app"\nversion="0.1"\n')
        (self.root/'main.go').write_text('package hello\n')
        rep=self.report();cats={x['category'] for x in rep['changes']}
        self.assertIn('observed-module',cats)
        self.assertIn('entrypoints',cats)
        self.assertIn('AGENTS.md',{x['path'] for x in rep['affected_docs']})
    def test_build_entry_change(self):
        self.go()
        (self.root/'Makefile').write_text('build:\n\tgo build ./...\n')
        rep=self.report();self.assertIn('build',{x['category'] for x in rep['changes']})
        self.assertIn('docs/PROJECT_GUIDE.md',{x['path'] for x in rep['affected_docs']})
    def test_spec_drift_maps_owner(self):
        self.go();(self.root/'docs/specs').mkdir()
        p=self.root/'docs/specs/api.md'
        p.write_text('---\nid: project.api.v1\n---\n# API\n')
        rep=self.report();self.assertIn('spec',{x['category'] for x in rep['changes']})
        self.assertIn('AGENTS.md',{x['path'] for x in rep['affected_docs']})
    def test_adopt_requires_explicit_fact_acceptance(self):
        self.root.mkdir();(self.root/'go.mod').write_text('module example.com/user\n')
        (self.root/'README.md').write_text('# Team\n')
        self.ok('adopt','--root',self.root)
        self.assertEqual(self.report()['status'],'unbaselined')
        self.assertNotEqual(self.call('guide','drift','--root',self.root,'--strict').returncode,0)
        self.ok('guide','facts','--root',self.root,'--apply')
        self.assertEqual(self.report()['status'],'clean')
        self.assertEqual((self.root/'README.md').read_text(),'# Team\n')
    def test_symlink_fact_snapshot_refused(self):
        self.go()
        snap=self.root/'.dairn/facts/project-facts.json'
        other=Path(self.tmp.name)/'external';other.write_text('do not touch')
        snap.unlink();snap.symlink_to(other)
        result=self.call('guide','facts','--apply','--root',self.root)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(other.read_text(),'do not touch')
    def test_readme_edits_do_not_generate_structural_drift(self):
        self.go()
        with (self.root/'README.md').open('a') as f:f.write('\nTeam maintained facts.\n')
        self.assertEqual(self.report()['status'],'clean')
        self.ok('validate','--root',self.root)
    def test_workflow_router_is_advisory(self):
        bug=json.loads(self.ok('workflow','recommend','修复登录鉴权报错').stdout)
        self.assertEqual(bug['classification'],'bug')
        self.assertIn('dairn-bugfix',{x['skill'] for x in bug['stages']})
        self.assertIn('dairn-code-review',{x['skill'] for x in bug['stages']})
        self.assertNotIn('dairn-grill',{x['skill'] for x in bug['stages']})
        self.assertTrue(any('not-applicable' in x for x in bug['invariants']))
        change=json.loads(self.ok('workflow','recommend','实现登录记住我功能').stdout)
        self.assertEqual(change['classification'],'change')
        change_skills=[x['skill'] for x in change['stages']]
        self.assertIn('dairn-grill',change_skills)
        self.assertLess(change_skills.index('dairn-grill'),change_skills.index('dairn-change-plan'))
        docs=json.loads(self.ok('workflow','recommend','README docs drift').stdout)
        self.assertEqual(docs['classification'],'documentation')
        self.assertIn('dairn-project-guidance',{x['skill'] for x in docs['stages']})
    def test_trusted_git_baseline_cannot_be_erased_by_pr_snapshot(self):
        self.go()
        def git(*argv):
            return subprocess.run(['git',*argv],cwd=self.root,check=True,capture_output=True,text=True).stdout.strip()
        git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Tester')
        git('add','.');git('commit','-qm','baseline')
        base=git('rev-parse','HEAD')
        (self.root/'go.mod').write_text((self.root/'go.mod').read_text()+'\nrequire example.com/x v1.2.3\n')
        self.ok('guide','facts','--root',self.root,'--apply')
        self.assertEqual(self.report()['status'],'clean')
        rep=json.loads(self.ok('guide','drift','--root',self.root,'--base',base).stdout)
        self.assertEqual(rep['status'],'drift')
        self.assertTrue(rep['baseline_source'].startswith('git:'))
        self.assertNotEqual(self.call('guide','drift','--root',self.root,'--base',base,'--strict').returncode,0)
        self.assertNotEqual(self.call('guide','facts','--root',self.root,'--base',base,'--apply').returncode,0)
    def test_missing_untrusted_git_ref_fails_closed(self):
        self.go()
        out=self.call('guide','drift','--root',self.root,'--base','DOES_NOT_EXIST','--strict')
        self.assertNotEqual(out.returncode,0)
        self.assertIn('trusted Git base',out.stderr)
    def test_non_dairn_skill_namespace_is_not_migrated(self):
        self.go()
        lockfile=self.root/'.dairn/lock.json';lock=json.loads(lockfile.read_text())
        folder=self.root/'.agents/skills/dairn-code-review'
        foreign=self.root/'.agents/skills/dev-code-review';folder.rename(foreign)
        for rel in list(lock['managed']):
            if '/dairn-code-review/' in rel:
                lock['managed'][rel.replace('/dairn-code-review/','/dev-code-review/')]=lock['managed'].pop(rel)
        lockfile.write_text(json.dumps(lock))
        before=lockfile.read_bytes()
        out=self.call('upgrade','--root',self.root,'--apply')
        self.assertNotEqual(out.returncode,0)
        self.assertEqual(lockfile.read_bytes(),before)
        self.assertTrue(foreign.exists())
        self.assertFalse(folder.exists())
    def test_non_dairn_extra_skill_is_rejected_without_conversion(self):
        self.go()
        lockfile=self.root/'.dairn/lock.json';lock=json.loads(lockfile.read_text())
        lock['config']['extra_skills']=['dev-tdd']
        lockfile.write_text(json.dumps(lock))
        before=lockfile.read_bytes()
        out=self.call('upgrade','--root',self.root,'--apply')
        self.assertNotEqual(out.returncode,0)
        self.assertEqual(lockfile.read_bytes(),before)
    def test_stack_skill_installed_automatically(self):
        self.go()
        for name in ('dairn-stack-go','dairn-governance','dairn-project-guidance'):
            self.assertTrue((self.root/'.agents/skills'/name/'SKILL.md').is_file(),name)
        self.assertTrue((self.root/'.agents/skills/dairn-stack-go/agents/openai.yaml').is_file())
        self.ok('validate','--root',self.root)
    def test_default_skills_only_use_dairn_prefix(self):
        self.go()
        root=self.root/'.agents/skills'
        names=[p.name for p in root.iterdir() if p.is_dir()]
        self.assertTrue(names)
        self.assertTrue(all(name.startswith('dairn-') for name in names),names)

if __name__=='__main__':unittest.main()
