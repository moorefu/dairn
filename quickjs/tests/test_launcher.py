"""项目内 launcher 与 vendored runtime：初始化、doctor、无 PATH 报错与 SHA256 校验。"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
CLI=ROOT/'dairn.sh'

class ProjectLauncher(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dairn-launcher-')
        self.addCleanup(self.tmp.cleanup)
        self.work=Path(self.tmp.name)
        self.root=self.work/'project'
        self.ok('init','--path',self.root,'--name','launcher_test','--stack','python','--ci','none')

    def call(self,*args,env=None):
        return subprocess.run([str(CLI),*map(str,args)],cwd=self.work,
                              env={**os.environ,**(env or {})},capture_output=True,text=True,timeout=180)

    def ok(self,*args,env=None):
        result=self.call(*args,env=env)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        return result

    def obj(self,*args,env=None):
        return json.loads(self.ok(*args,env=env).stdout)

    def launcher_config(self):
        return json.loads((self.root/'.dairn/launcher.json').read_text(encoding='utf-8'))

    def launcher_version(self,path):
        # launcher 自身是 /bin/sh 脚本，不依赖执行位；PATH 传空串时 launcher 会恢复
        # 内置最小系统 PATH 以支持 APE 加载器（且不会依赖全局安装的 dairn）。
        return subprocess.run(['/bin/sh','.dairn/bin/dairn','version'],cwd=self.root,
                              env={**os.environ,'PATH':path,'DAIRN_BIN':''},capture_output=True,text=True,timeout=120)

    def test_init_writes_project_launcher_and_doctor_reports_it(self):
        self.assertTrue((self.root/'.dairn/bin/dairn').is_file())
        self.assertTrue((self.root/'.dairn/bin/dairn.cmd').is_file())
        self.assertTrue((self.root/'.dairn/launcher.json').is_file())
        config=self.launcher_config()
        self.assertEqual(config['mode'],'external')
        self.assertIsNone(config['runtime'])
        doctor=self.obj('doctor','--json','--root',self.root)
        self.assertEqual(doctor['status'],'ready',doctor.get('problems'))
        self.assertIn('.dairn/bin/dairn',doctor['launcher']['resolved'])
        self.assertEqual(doctor['launcher']['mode'],'external')
        self.assertTrue(doctor['invocation'])
        self.assertIn('doctor',doctor['invocation'])

    def test_missing_runtime_without_path_reports_dairn_not_found(self):
        # 非空但不含 dairn 的 PATH，避免 launcher 在 PATH 为空时恢复系统 PATH 后命中全局安装的 dairn。
        result=self.launcher_version('/nonexistent')
        self.assertEqual(result.returncode,127,result.stdout+'\n'+result.stderr)
        self.assertIn('dairn not found',result.stderr)

    def test_vendor_runtime_registers_and_executes_offline(self):
        source=ROOT/'runtime/dairn-embedded.com'
        integrity_source=ROOT/'runtime/runtime-integrity.json'
        self.assertTrue(source.is_file(),'missing build runtime: '+str(source))
        self.assertTrue(integrity_source.is_file(),'missing runtime integrity: '+str(integrity_source))
        runtime_dir=self.root/'.dairn/runtime'
        runtime_dir.mkdir(parents=True,exist_ok=True)
        binary=runtime_dir/'dairn-embedded.com'
        integrity=runtime_dir/'runtime-integrity.json'
        shutil.copyfile(source,binary)
        shutil.copyfile(integrity_source,integrity)
        os.chmod(binary,0o755)
        self.ok('upgrade','--vendor-runtime','.dairn/runtime','--apply','--root',self.root)
        config=self.launcher_config()
        self.assertEqual(config['mode'],'vendored')
        declared=json.loads(integrity.read_text(encoding='utf-8'))['sha256']
        self.assertEqual(config['runtime']['sha256'],declared)
        self.assertEqual(config['runtime']['path'],'.dairn/runtime/dairn-embedded.com')
        doctor=self.obj('doctor','--json','--root',self.root)
        self.assertEqual(doctor['status'],'ready',doctor.get('problems'))
        self.assertEqual(doctor['launcher']['mode'],'vendored')
        self.assertEqual(doctor['launcher']['runtime']['path'],'.dairn/runtime/dairn-embedded.com')
        result=self.launcher_version('')
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        self.assertIn('Dairn ',result.stdout)
        # 篡改 vendored 二进制后，doctor 必须发现摘要不符并非零退出。
        data=bytearray(binary.read_bytes())
        data[len(data)//2]^=0xff
        binary.write_bytes(bytes(data))
        broken=self.call('doctor','--json','--root',self.root)
        self.assertNotEqual(broken.returncode,0,broken.stdout+'\n'+broken.stderr)
        combined=(broken.stdout+broken.stderr).lower()
        self.assertTrue('sha256' in combined or 'mismatch' in combined,broken.stdout+broken.stderr)

if __name__=='__main__':unittest.main()
