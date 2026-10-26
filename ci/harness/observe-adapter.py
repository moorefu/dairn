"""源码仓库的 Harness 事件桥入口，实际实现与分发模板同源。"""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).resolve().parents[2] / 'quickjs/assets/templates/project/hooks/observe-adapter.py'), run_name='__main__')
