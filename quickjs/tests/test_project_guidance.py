"""Governance documentation lifecycle tests. Runs the REAL Bellard Cosmo QuickJS APE."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/('dairn.cmd' if os.name=='nt' else 'dairn.sh')

class Guidance(unittest.TestCase):
    def setUp(self):
        (ROOT/'.dairn/tmp').mkdir(parents=True, exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(prefix='dairn-guidance-', dir=str(ROOT/'.dairn/tmp'))
        self.root=Path(self.temp.name)/'repo'
        self.env={**os.environ, 'GIT_CEILING_DIRECTORIES': str(Path(self.temp.name).parent),
                  'TMPDIR': self.temp.name, 'TEMP': self.temp.name, 'TMP': self.temp.name}
    def tearDown(self): self.temp.cleanup()
    def runcli(self,*argv):
        return subprocess.run([str(CLI),*map(str,argv)],cwd=self.temp.name,env=self.env,
                              capture_output=True,text=True,encoding='utf-8',errors='replace')
    def ok(self,*argv):
        p=self.runcli(*argv);self.assertEqual(p.returncode,0,p.stdout+'\n'+p.stderr);return p
    def initgo(self): self.ok('init','--path',self.root,'--stack','go','--sample')
    def test_default_skill_and_no_fiction(self):
        self.initgo()
        self.assertTrue((self.root/'.agents/skills/dairn-project-guidance/SKILL.md').is_file())
        README=(self.root/'README.md').read_text(encoding='utf-8')
        GUIDE=(self.root/'docs/PROJECT_GUIDE.md').read_text(encoding='utf-8')
        self.assertIn('TODO:',README)
        self.assertIn('configured commands, not claims of successful execution',GUIDE)
        self.assertIn('go test ./...',GUIDE)
        self.ok('validate','--root',self.root)
        audit=json.loads(self.ok('guide','audit','--root',self.root,'--strict').stdout)
        self.assertEqual(audit['warnings'],[])
        self.assertEqual(audit['errors'],[])
    def test_plan_and_check_do_not_write(self):
        self.initgo()
        before={p:p.read_bytes() for p in (self.root/'README.md',self.root/'docs/PROJECT_GUIDE.md',self.root/'.dairn/lock.json')}
        plan=json.loads(self.ok('guide','plan','--root',self.root).stdout)
        self.assertEqual(plan['recommended_skill'],'dairn-project-guidance')
        self.assertFalse(plan['facts'][0]['commands']['unit']['verified'])
        for p,c in before.items():self.assertEqual(p.read_bytes(),c)
        self.assertNotIn('README.md',json.loads((self.root/'.dairn/lock.json').read_text(encoding='utf-8'))['managed'])
    def test_edit_project_owned_docs_does_not_break_lock_or_upgrade(self):
        self.initgo()
        readme=self.root/'README.md';guide=self.root/'docs/PROJECT_GUIDE.md'
        readme.write_text(readme.read_text(encoding='utf-8')+'\n## Team section\nApproved team content.\n',encoding='utf-8')
        guide.write_text(guide.read_text(encoding='utf-8')+'\nVerified from code: hello.go\n',encoding='utf-8')
        self.ok('validate','--root',self.root)
        self.ok('upgrade','--root',self.root,'--apply')
        self.assertIn('Team section',readme.read_text(encoding='utf-8'))
        self.assertIn('Verified from code',guide.read_text(encoding='utf-8'))
    def test_existing_readme_and_project_guide_preserved(self):
        self.root.mkdir()
        (self.root/'go.mod').write_text('module example.com/existing\n',encoding='utf-8')
        (self.root/'README.md').write_text('# Existing project\nKeep this.\n',encoding='utf-8')
        (self.root/'docs').mkdir()
        (self.root/'docs/PROJECT_GUIDE.md').write_text('# Our architecture\nKeep this too.\n',encoding='utf-8')
        self.ok('adopt','--root',self.root,'--plan')
        self.ok('adopt','--root',self.root)
        self.assertEqual((self.root/'README.md').read_text(encoding='utf-8'),'# Existing project\nKeep this.\n')
        self.assertEqual((self.root/'docs/PROJECT_GUIDE.md').read_text(encoding='utf-8'),'# Our architecture\nKeep this too.\n')
        audit=json.loads(self.ok('guide','audit','--root',self.root).stdout)
        self.assertTrue(any('README' in w for w in audit['warnings']))
        self.assertNotEqual(self.runcli('guide','audit','--root',self.root,'--strict').returncode,0)
        self.ok('validate','--root',self.root)
    def test_missing_docs_is_reported(self):
        self.initgo()
        (self.root/'docs/PROJECT_GUIDE.md').unlink()
        p=self.ok('guide','audit','--root',self.root)
        self.assertIn('Missing project documentation',p.stdout)
        self.assertEqual(self.runcli('guide','audit','--root',self.root,'--strict').returncode,2)
        # Missing user-owned documents must NOT violate locked managed assets.
        self.ok('validate','--root',self.root)
    def test_breaking_local_links(self):
        self.initgo()
        p=self.root/'docs/PROJECT_GUIDE.md'
        p.write_text(p.read_text(encoding='utf-8')+'\n[Broken link](missing-doc.md)\n',encoding='utf-8')
        audit=json.loads(self.ok('guide','audit','--root',self.root).stdout)
        self.assertTrue(any('broken local Markdown link' in w for w in audit['warnings']))
        self.assertEqual(self.runcli('guide','audit','--root',self.root,'--strict').returncode,2)
    def test_readonly_managed_navigation(self):
        self.initgo()
        p=self.root/'AGENTS.md'
        p.write_text(p.read_text(encoding='utf-8').replace('Dairn — AI-Native','Dairn HACK — AI-Native'),encoding='utf-8')
        self.assertNotEqual(self.runcli('guide','plan','--root',self.root).returncode,0)
    def test_initial_plan_and_adopt_symlink_still_safe(self):
        self.root.mkdir()
        (self.root/'go.mod').write_text('module example.com/test\n',encoding='utf-8')
        other=Path(self.temp.name)/'outside';other.mkdir()
        (self.root/'docs').symlink_to(other,target_is_directory=True)
        self.assertEqual(self.runcli('adopt','--root',self.root).returncode,2)
        self.assertEqual(list(other.iterdir()),[])

    def test_scaffold_only_missing_and_preview(self):
        self.initgo()
        readme=self.root/'README.md'
        guide=self.root/'docs/PROJECT_GUIDE.md'
        readme.write_text('# Team owned\n',encoding='utf-8')
        guide.unlink()
        plan=json.loads(self.ok('guide','scaffold','--root',self.root).stdout)
        self.assertFalse(plan['applied'])
        self.assertEqual({x['path']:x['status'] for x in plan['actions']},
                         {'README.md':'preserved','docs/PROJECT_GUIDE.md':'create'})
        self.assertFalse(guide.exists())
        self.ok('guide','scaffold','--root',self.root,'--apply')
        self.assertTrue(guide.exists())
        self.assertEqual(readme.read_text(encoding='utf-8'),'# Team owned\n')
        self.ok('validate','--root',self.root)
    def test_scaffold_symlink_block(self):
        self.initgo()
        readme=self.root/'README.md';readme.unlink()
        external=Path(self.temp.name)/'outside';external.write_text('do not touch',encoding='utf-8')
        readme.symlink_to(external)
        before=external.read_bytes()
        self.assertEqual(self.runcli('guide','scaffold','--root',self.root,'--apply').returncode,2)
        self.assertEqual(external.read_bytes(),before)

if __name__=='__main__': unittest.main()
