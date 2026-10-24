#!/usr/bin/env python3
"""Project-owned Python interface analyzer using the standard library (optional Dairn Analyzer)."""
import ast
import json
import subprocess
import sys
from pathlib import Path


def signatures(src):
    if not src:
        return {}
    parsed = ast.parse(src)
    found = {}
    for node in parsed.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and not node.name.startswith('_'):
            found['func:' + node.name] = ast.unparse(node.args) + (' async' if isinstance(node, ast.AsyncFunctionDef) else '')
        elif isinstance(node, ast.ClassDef) and not node.name.startswith('_'):
            found['class:' + node.name] = ','.join(ast.unparse(x) for x in node.bases)
            for method in node.body:
                if isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)) and not method.name.startswith('_'):
                    found[f'method:{node.name}.{method.name}'] = ast.unparse(method.args)
    return found


def run(req, response):
    r = json.loads(Path(req).read_text())
    if r.get('schema') != 'dairn.analyzer-request.v1' or r.get('domain') != 'surface' or not (r.get('subject') or {}).get('base_commit'):
        raise ValueError('schema/domain/subject.base_commit required')
    root = Path(r['root']).resolve()
    base = r['subject']['base_commit']
    head = r['subject']['source_commit']
    def git(*args):
        return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True).stdout
    names = git('diff', '--name-only', '--diff-filter=ACDMRT', base, head, '--').decode().splitlines()
    changes = []
    if len(names) > 500:
        raise ValueError('too many changed files')
    for name in names:
        rel = Path(name)
        if rel.suffix != '.py' or rel.is_absolute() or '..' in rel.parts:
            continue
        before = subprocess.run(['git', '-C', str(root), 'show', f'{base}:{name}'], check=False, capture_output=True)
        pre = signatures(before.stdout.decode('utf-8')) if before.returncode == 0 else {}
        candidate = root / rel
        if candidate.is_symlink():
            raise ValueError('symlink source forbidden')
        post = signatures(candidate.read_text()) if candidate.exists() else {}
        for symbol in sorted(pre.keys() | post.keys()):
            if pre.get(symbol) == post.get(symbol):
                continue
            changes.append({'path':name, 'symbol':symbol, 'change':'changed' if symbol in pre and symbol in post else 'added' if symbol in post else 'removed', 'before':pre.get(symbol, ''), 'after':post.get(symbol, '')})
    payload = {'schema':'dairn.surface-result.v1','analyzer_id':r['analyzer_id'],'domain':'surface','subject':{'source_commit':head,'base_commit':base},'changes':changes}
    Path(response).write_text(json.dumps(payload)+'\n')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: python-surface.py REQUEST.json RESPONSE.json')
    run(*sys.argv[1:])
