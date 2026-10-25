"""在候选的私有副本上测量观测组件，输出仅为本机测量，不替代跨平台性能验收。"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from runtime_context import test_runtime

ROOT = Path(__file__).resolve().parents[1]
source = test_runtime()
with tempfile.TemporaryDirectory(prefix='dairn-observe-benchmark-') as directory:
    binary = Path(directory) / 'qjs.com'
    shutil.copyfile(source, binary)
    binary.chmod(0o700)
    command = [str(binary)] if os.name == 'nt' else ['/bin/sh', str(binary)]
    sys.exit(subprocess.call([*command, str(ROOT / 'quickjs/tests/benchmark_observe.mjs')], cwd=ROOT,env={**os.environ,'TMPDIR':directory,'TEMP':directory,'TMP':directory}))
