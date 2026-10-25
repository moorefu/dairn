"""故障注入：删除任一必需测试，剩余测试全绿也必须拒绝覆盖验收。"""
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_catalog import CI_SOURCE_STAGES, coverage, required_ids


class CheckCoverage(unittest.TestCase):
    def test_missing_failed_or_duplicate_check_cannot_pass(self):
        for stage in (*CI_SOURCE_STAGES, 'build'):
            records = [{'check_id': key, 'exit_code': 0} for key in required_ids(stage)]
            self.assertTrue(coverage(stage, records)['complete'])
            for index, item in enumerate(records):
                with self.subTest(stage=stage, removed=item['check_id']):
                    result = coverage(stage, records[:index] + records[index + 1:])
                    self.assertFalse(result['complete'])
                    self.assertEqual(result['missing'], [item['check_id']])
            self.assertFalse(coverage(stage, records + [records[0]])['complete'])
            records[0]['exit_code'] = 1
            self.assertFalse(coverage(stage, records)['complete'])


if __name__ == '__main__':
    unittest.main()
