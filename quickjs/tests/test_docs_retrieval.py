"""S3: docs 检索精度——排序、结构化输出、章节/行范围与上下文截断。

覆盖：
- `docs find --json` 返回 dairn.docs-find.v1：多词 AND、score 降序、rank_reason 非空；
- 文本输出保持兼容（`id<TAB>path`），并附加 `docs show` 下一步提示；
- `docs show --section/--lines/--json` 输出精确片段；
- `docs context` 截断落在行边界并保留 marker；
- 错误路径统一 exit 2（未知 section、非法行范围、互斥参数）。

中文参数在 Windows cmd.exe 下可能按本地代码页转码，故经 section 名称的用例只在 POSIX 运行。
"""
import json
import os
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ('dairn.cmd' if os.name == 'nt' else 'dairn')
SPEC_ID = 'dairn.docs.discovery'


class DocsRetrievalTest(unittest.TestCase):
    def call(self, *args):
        return subprocess.run([str(CLI), *map(str, args), '--root', str(ROOT)],
                              capture_output=True, encoding='utf-8', errors='replace',
                              timeout=180, env=os.environ.copy())

    def json_call(self, *args):
        result = self.call(*args)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def test_find_json_is_ranked_and_explainable(self):
        report = self.json_call('docs', 'find', 'launcher', '--json')
        self.assertEqual(report['schema'], 'dairn.docs-find.v1')
        self.assertEqual(report['query'], 'launcher')
        self.assertEqual(report['terms'], ['launcher'])
        self.assertTrue(report['hits'], report)
        for hit in report['hits']:
            self.assertTrue(hit['rank_reason'], hit)
            self.assertIn('path', hit)
            self.assertIn('score', hit)
        scores = [hit['score'] for hit in report['hits']]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertEqual(report['hits'][0]['id'], 'dairn.engineering.launcher')

    def test_find_multi_term_is_and_scored(self):
        report = self.json_call('docs', 'find', 'launcher', 'runtime', '--json')
        self.assertEqual(report['terms'], ['launcher', 'runtime'])
        self.assertTrue(report['hits'])
        self.assertEqual(report['hits'][0]['id'], 'dairn.engineering.launcher')
        single = self.json_call('docs', 'find', 'launcher', '--json')
        self.assertGreater(report['hits'][0]['score'], single['hits'][0]['score'])
        self.assertIn('aliases', report['hits'][0]['rank_reason'])
        # 多词 AND：只命中第二个词、不命中第一个词的文档不得出现。
        only = self.json_call('docs', 'find', 'format', '--json')
        self.assertIn('dairn.notes.format', [hit['id'] for hit in only['hits']])
        both = self.call('docs', 'find', 'launcher', 'format', '--json')
        self.assertEqual(both.returncode, 1, both.stdout + both.stderr)
        self.assertEqual(json.loads(both.stdout)['hits'], [])

    def test_find_text_output_remains_compatible(self):
        result = self.call('docs', 'find', 'launcher')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('dairn.engineering.launcher\t', result.stdout)
        self.assertIn('dairn docs show ', result.stderr)

    def test_find_no_match_exits_1(self):
        text = self.call('docs', 'find', 'zzz-no-such-token')
        self.assertEqual(text.returncode, 1, text.stdout + text.stderr)
        report = self.call('docs', 'find', 'zzz-no-such-token', '--json')
        self.assertEqual(report.returncode, 1, report.stdout + report.stderr)
        payload = json.loads(report.stdout)
        self.assertEqual(payload['hits'], [])
        self.assertFalse(payload['truncated'])
        self.assertIn('AND', payload['hint'])
        self.assertIn('没有匹配规范', text.stderr)

    def test_show_full_and_line_range(self):
        full = self.json_call('docs', 'show', SPEC_ID, '--json')
        self.assertEqual(full['schema'], 'dairn.docs-show.v1')
        self.assertEqual(full['line_range'][0], 1)
        self.assertGreater(full['line_range'][1], 20)
        self.assertIn('## 当前限制', full['text'])
        lines = self.json_call('docs', 'show', SPEC_ID, '--lines', '1-5', '--json')
        self.assertEqual(lines['line_range'], [1, 5])
        self.assertEqual(lines['id'], SPEC_ID)
        self.assertNotIn('## 当前限制', lines['text'])
        # 默认文本输出仍为全文（不破坏既有调用）。
        plain = self.call('docs', 'show', SPEC_ID)
        self.assertEqual(plain.returncode, 0, plain.stderr)
        self.assertIn('## 当前限制', plain.stdout)

    def test_show_invalid_arguments_exit_2(self):
        for args in (('--lines', '0-5'), ('--lines', '5-1'), ('--lines', 'x'),
                     ('--section', 'no-such-section'),
                     ('--section', 'no-such-section', '--lines', '1-2')):
            result = self.call('docs', 'show', SPEC_ID, *args)
            self.assertEqual(result.returncode, 2, (args, result.stdout, result.stderr))
            self.assertIn('Dairn ERROR:', result.stderr, (args, result.stderr))

    @unittest.skipIf(os.name == 'nt', 'cmd.exe 可能按本地代码页转码中文参数')
    def test_show_section_excerpt(self):
        report = self.json_call('docs', 'show', SPEC_ID, '--section', '当前限制', '--json')
        self.assertIn('## 当前限制', report['text'])
        self.assertNotIn('## 文档元数据', report['text'])
        start, end = report['line_range']
        self.assertGreaterEqual(start, 2)
        self.assertGreaterEqual(end, start)
        self.assertLess(end - start, 60)

    def test_context_truncation_is_line_boundary_with_marker(self):
        result = self.call('docs', 'context', 'dairn.engineering.launcher')
        self.assertEqual(result.returncode, 0, result.stderr)
        marker = '[truncated at 8000 characters'
        self.assertIn(marker, result.stdout)
        self.assertIn('dairn docs show dairn.engineering.launcher', result.stdout)
        self.assertLess(len(result.stdout), 9000)
        truncated = result.stdout.split(marker, 1)[0]
        # marker 独立成行：截断内容以换行结束，说明截断点落在行边界。
        self.assertTrue(truncated.endswith('\n'), repr(truncated[-40:]))
        self.assertGreater(len(truncated), 4000)

    def test_context_missing_id_is_usage_error(self):
        result = self.call('docs', 'context')
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('Dairn ERROR:', result.stderr)
        self.assertIn('docs', result.stderr.lower())


if __name__ == '__main__':
    unittest.main()
