"""Tests the actual official Cosmo QuickJS CLI (not mock JavaScript)."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/'dairn.sh'
class MultilanguageStubs(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='dairn-multilang-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'project'
        self.run_dairn('init','--path',str(self.root),'--stack','go','--sample',root=False)
    def run_dairn(self,*args,root=True,ok=True):
        cmd=[str(CLI),*args]
        if root:cmd+=['--root',str(self.root)]
        p=subprocess.run(cmd,capture_output=True,text=True,timeout=90)
        if ok:self.assertEqual(p.returncode,0,p.stdout+'\n'+p.stderr)
        return p
    def obj(self,*args):return json.loads(self.run_dairn(*args).stdout)
    def git(self,*args):
        p=subprocess.run(['git',*args],cwd=self.root,capture_output=True,text=True,check=True)
        return p.stdout.strip()
    def commit(self,message):
        self.git('add','.')
        self.git('commit','-qm',message)
        return self.git('rev-parse','HEAD')
    def git_setup(self):
        self.git('init','-q');self.git('config','user.email','test@example.test');self.git('config','user.name','Test')
    def test_catalog_and_readonly_plan(self):
        names={x['name'] for x in self.obj('stubs','templates')}
        self.assertEqual(names,{'go','python','javascript','typescript','java','rust','php','lua','shell','ruby','csharp'})
        original=(self.root/'.dairn/stubs.json').read_bytes()
        for name in names:
            p=self.obj('stubs','init','--template',name,'--id',name+'-stub')
            self.assertFalse(p['applied'])
            self.assertEqual(original,(self.root/'.dairn/stubs.json').read_bytes())
            self.assertTrue(all(not (self.root/x).exists() for x in p['files'][:-1]))
    def test_multifile_install_and_validation(self):
        for name in ('rust','csharp'):
            p=self.obj('stubs','init','--template',name,'--id',name+'-stub','--apply')
            self.assertGreater(len(p['files']),2)
            self.assertTrue(all((self.root/x).exists() for x in p['files']))
            self.assertIn('target/\n' if name=='rust' else 'bin/\nobj/\n',(self.root/'tools/dairn/stubs'/name/'.gitignore').read_text())
        installed=self.obj('stubs','list')['configured']
        self.assertEqual(len(installed),2)
        self.run_dairn('validate')
        doctor=self.run_dairn('stubs','doctor',ok=False)
        report=json.loads(doctor.stdout)
        self.assertEqual(doctor.returncode,2)  # missing Cargo/dotnet must not be reported as ready
        self.assertEqual(len(report['tools']),2)
        self.assertFalse(report['ready'])
    def test_real_language_execution_through_quickjs(self):
        self.git_setup()
        cases={
            'go':('api_extra.go','package hello\nfunc Extra(){}\n','package hello\nfunc Extra(x int){}\n'),
            'python':('api.py','def api():\n return 1\n','def api(x):\n return x\n'),
            'javascript':('api.mjs','export function api() {}\n','export function api(x) {}\n'),
            'typescript':('api.ts','export function api(): void {}\n','export function api(x: number): void {}\n'),
            'java':('Api.java','public class Api {\n public void example() {}\n}\n','public class Api {\n public void example(int x) {}\n}\n'),
            'php':('api.php','<?php\nfunction example() {}\n','<?php\nfunction example($x) {}\n'),
            'ruby':('api.rb','def example()\nend\n','def example(x)\nend\n'),
            'shell':('api.sh','example() { :; }\n','example() { echo ok; }\n')
        }
        for name,(filename,before,_) in cases.items():
            self.obj('stubs','init','--template',name,'--id',name+'-id','--apply')
            (self.root/filename).write_text(before)
        base=self.commit('baseline')
        for filename,_,after in cases.values():
            (self.root/filename).write_text(after)
        self.commit('interfaces changed')
        for name,(filename,_,__) in cases.items():
            with self.subTest(name=name):
                impact=self.obj('guide','impact','--base',base,'--precision',name+'-id')
                self.assertEqual(impact['stub_analysis']['source'],'project-stub')
                self.assertTrue(any(c['path']==filename for c in impact['stub_analysis']['changes']),str(impact['stub_analysis']))
    def test_collision_is_atomic(self):
        p=self.root/'tools/dairn/stubs/rust/Cargo.toml';p.parent.mkdir(parents=True);p.write_text('existing')
        original=(self.root/'.dairn/stubs.json').read_bytes()
        result=self.run_dairn('stubs','init','--template','rust','--id','rust-id','--apply',ok=False)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(p.read_text(),'existing')
        self.assertEqual(original,(self.root/'.dairn/stubs.json').read_bytes())
        self.assertFalse((self.root/'tools/dairn/stubs/rust/src/main.rs').exists())
    def test_symlink_ancestor_rejected(self):
        outside=Path(self.temp.name)/'outside';outside.mkdir()
        (self.root/'tools').symlink_to(outside,target_is_directory=True)
        self.assertNotEqual(self.run_dairn('stubs','init','--template','java','--apply',ok=False).returncode,0)
        self.assertEqual(list(outside.iterdir()),[])
    def test_missing_explicit_precision_fails(self):
        self.git_setup();base=self.commit('start')
        self.assertNotEqual(self.run_dairn('guide','impact','--base',base,'--precision','not-installed',ok=False).returncode,0)

if __name__=='__main__':unittest.main()
