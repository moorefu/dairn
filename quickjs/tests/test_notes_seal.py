"""Agent Notes 归档封存：`dairn notes seal` 规划/写入与基线不可改写校验。"""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/'dairn.sh'

NOTE='''# Agent Note: Choose storage engine

Status: implemented
Archived: 2026-10-01

## Problem
Need durable storage for issued tokens.

## Decision
Reuse the existing relational database.

## Alternatives considered
Object storage with a separate lifecycle.

## Consequences
A migration is required before enforcement.
'''

class NotesSeal(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dairn-notes-seal-')
        self.addCleanup(self.tmp.cleanup)
        self.work=Path(self.tmp.name)
        self.root=self.work/'project'
        self.ok('init','--path',self.root,'--stack','go','--sample')
        self.note=self.root/'.agents/notes/archived/architecture/2026-10-01-storage.md'
        # init 会预建 archived/<kind> 目录（空目录不随 Git 分发），这里允许已存在。
        self.note.parent.mkdir(parents=True, exist_ok=True)
        self.note.write_text(NOTE)

    def call(self,*args):
        return subprocess.run([str(CLI),*map(str,args)],cwd=self.work,capture_output=True,text=True,timeout=120)

    def ok(self,*args):
        result=self.call(*args)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        return result

    def obj(self,*args):return json.loads(self.ok(*args).stdout)

    def git(self,*args):
        return subprocess.run(['git',*args],cwd=self.root,capture_output=True,text=True,check=True).stdout.strip()

    def manifest(self):return self.root/'.agents/notes/archived/sha256.json'

    def test_seal_plan_is_readonly_and_apply_writes_digests(self):
        before=self.manifest().read_text()
        plan=self.obj('notes','seal','--root',self.root)
        self.assertFalse(plan['apply'])
        self.assertEqual(plan['files'],['architecture/2026-10-01-storage.md'])
        self.assertEqual(self.manifest().read_text(),before)
        applied=self.obj('notes','seal','--apply','--root',self.root)
        self.assertTrue(applied['apply'])
        sealed=json.loads(self.manifest().read_text())
        self.assertEqual(sealed['architecture/2026-10-01-storage.md'],
                         hashlib.sha256(self.note.read_bytes()).hexdigest())

    def test_sealed_note_cannot_be_rewritten_after_trusted_base(self):
        self.obj('notes','seal','--apply','--root',self.root)
        self.git('init','-q')
        self.git('config','user.email','test@example.com')
        self.git('config','user.name','Tester')
        self.git('add','.')
        self.git('commit','-qm','sealed baseline')
        base=self.git('rev-parse','HEAD')
        self.ok('validate','--root',self.root,'--base',base)
        self.note.write_text(self.note.read_text()+'\nRewritten after seal.\n')
        mutated=self.call('validate','--root',self.root,'--base',base)
        self.assertNotEqual(mutated.returncode,0)
        self.assertIn('sealed archive mutated',mutated.stderr)

if __name__=='__main__':unittest.main()
