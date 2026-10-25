"""以 hashlib 和 Node crypto 为独立参照，交叉验证 Node/QuickJS 的摘要。"""
import hashlib
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class Sha256CrossRuntime(unittest.TestCase):
    def test_boundaries_binary_unicode_and_repeated_calls(self):
        expected, calls = [], []
        rng = random.Random(20261025)
        for size in (0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 257, 4096):
            data = rng.randbytes(size)
            expected.append(hashlib.sha256(data).hexdigest())
            calls.append('binary(new Uint8Array(' + json.dumps(list(data)) + '));')
        large = bytes((i * 131 + 17) % 256 for i in range(1024 * 1024))
        expected.append(hashlib.sha256(large).hexdigest())
        calls.append('binary(Uint8Array.from({length:1048576},(_,i)=>(i*131+17)%256));')
        texts = ['', 'abc', 'a' * 1000000, '中文😀', 'é\u0301\u0000日本語',
                 '\ud800', '\udfff', '前\ud800后', '\ud800\ud800\udc00', 'abc']
        for text in texts:
            # 既有契约：孤立代理项按 surrogatepass 编码；有效代理对按码点编码。
            normalized = text.encode('utf-16-le', 'surrogatepass').decode('utf-16-le', 'surrogatepass')
            encoded = normalized.encode('utf-8', 'surrogatepass')
            expected.append(hashlib.sha256(encoded).hexdigest())
            literal = "'a'.repeat(1000000)" if len(text) == 1000000 else json.dumps(text)
            calls.append('text(' + literal + ',' +
                         ('null' if len(text) == 1000000 else json.dumps(list(encoded))) + ');')
        module = (ROOT / 'quickjs/core/sha256.mjs').as_uri()
        body = '\n'.join(calls)
        base = f"import {{sha256,sha256Bytes}} from {json.dumps(module)};\nconst actual=[];\n"
        with tempfile.TemporaryDirectory(prefix='dairn-sha256-') as tmp:
            temp = Path(tmp)
            qjs_source = Path(os.environ.get('DAIRN_QJS_BIN', ROOT / 'runtime/dairn-embedded.com'))
            qjs = temp / 'qjs.com'
            shutil.copyfile(qjs_source, qjs)
            qjs.chmod(0o755)
            for engine in ('node', 'quickjs'):
                if engine == 'node':
                    script = base + "import {createHash} from 'node:crypto';\nconst oracle=[];\n"
                    script += "const binary=b=>{actual.push(sha256Bytes(b));oracle.push(createHash('sha256').update(b).digest('hex'));};\n"
                    script += "const text=(s,b)=>{actual.push(sha256(s));oracle.push(createHash('sha256').update(b===null?s:Buffer.from(b)).digest('hex'));};\n"
                    script += body + '\nconsole.log(JSON.stringify({actual,oracle}));\n'
                    command = ['node']
                else:
                    script = base.replace(json.dumps(module), json.dumps((ROOT / 'quickjs/core/sha256.mjs').as_posix()))
                    script += 'const binary=b=>actual.push(sha256Bytes(b));\nconst text=s=>actual.push(sha256(s));\n'
                    script += body + '\nprint(JSON.stringify({actual}));\n'
                    command = [str(qjs)] if os.name == 'nt' else ['/bin/sh', str(qjs)]
                path = temp / (engine + '.mjs')
                path.write_text(script, encoding='utf-8')
                result = subprocess.run(command + [str(path)], capture_output=True,
                                        encoding='utf-8', errors='replace', timeout=120)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                observed = json.loads(result.stdout)
                with self.subTest(engine=engine):
                    self.assertEqual(observed['actual'], expected)
                    if engine == 'node':
                        self.assertEqual(observed['oracle'], expected)


if __name__ == '__main__':
    unittest.main()
