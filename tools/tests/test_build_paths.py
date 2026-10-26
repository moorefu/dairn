"""在非 Windows 主机也校验构建路径协议，真实 Windows 文件操作仍由矩阵验收。"""
import json
from pathlib import Path
import subprocess
import unittest


class BuildPaths(unittest.TestCase):
    def test_windows_and_unix_parent_paths_are_preserved(self):
        module=Path(__file__).resolve().parents[1]/'build-paths.mjs'
        cases=[
            [r'C:\project\.build\runs\one\runtime',r'C:\project','C:/project/.build/runs/one/runtime'],
            [r'relative\runtime',r'C:\project','C:/project/relative/runtime'],
            ['/tmp/project/runtime','/repo','/tmp/project/runtime'],
            ['runtime','/repo/','/repo/runtime'],
        ]
        script='import {absoluteBuildPath} from '+json.dumps(module.as_uri())+';\n'+\
               'console.log(JSON.stringify('+json.dumps(cases)+'.map(([p,cwd])=>absoluteBuildPath(p,cwd))));'
        result=subprocess.run(['node','--input-type=module','-e',script],capture_output=True,text=True,check=True)
        actual=json.loads(result.stdout)
        self.assertEqual(actual,[case[2] for case in cases])
        self.assertEqual(actual[0].rsplit('/',1),['C:/project/.build/runs/one','runtime'])
