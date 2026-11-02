import importlib.util
from pathlib import Path
import tempfile
import unittest
import json

spec = importlib.util.spec_from_file_location('sliper_monitor', Path(__file__).resolve().parents[1] / 'deploy/native/sliper-monitor.py')
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)

class MonitorTests(unittest.TestCase):
    def record(self):
        return {'version':1,'worker':'notification','pid':123,'startedAt':100000,'succeededAt':990000,'stopping':False}

    def test_worker_requires_live_service_pid_and_fresh_success(self):
        good = self.record()
        self.assertTrue(monitor.worker_healthy(good, 'notification', 123, 1000))
        self.assertFalse(monitor.worker_healthy(good, 'notification', 456, 1000))
        self.assertFalse(monitor.worker_healthy(dict(good, succeededAt=500000), 'notification', 123, 1000))
        self.assertFalse(monitor.worker_healthy(dict(good, succeededAt=1006000), 'notification', 123, 1000))
        self.assertFalse(monitor.worker_healthy(dict(good, stopping=True), 'notification', 123, 1000))
        self.assertFalse(monitor.worker_healthy(dict(good, succeededAt=None), 'notification', 123, 1000))

    def test_video_has_its_distinct_progress_timeout(self):
        record = dict(self.record(), worker='video', succeededAt=200000)
        self.assertTrue(monitor.worker_healthy(record, 'video', 123, 1000))
        self.assertFalse(monitor.worker_healthy(record, 'video', 123, 1200))

    def test_public_endpoint_does_not_reveal_failure_details(self):
        value = {'version':1,'checkedAt':1000,'healthy':True,'checks':{'certificate-valid-48h':True}}
        self.assertEqual(monitor.public_status(value, 1000), (200, b'{"status":"ok"}\n'))
        failed = dict(value, healthy=False, checks={'sensitive-failure-location':False})
        self.assertEqual(monitor.public_status(failed, 1000), (503, b'{"status":"unavailable"}\n'))
        self.assertNotIn(b'sensitive', monitor.public_status(failed,1000)[1])

    def test_stale_future_or_malformed_snapshot_fails_closed(self):
        good = {'version':1,'checkedAt':1000,'healthy':True,'checks':{'web':True}}
        for v,now in [(good,1121),(good,999),({},1000),(dict(good,checks={}),1000),(dict(good,checks=[]),1000),(dict(good,healthy='true'),1000)]:
            self.assertEqual(monitor.public_status(v,now)[0],503)

    def test_status_files_are_bounded_and_parsed_as_data(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'state.json'
            p.write_text(json.dumps({'valid':True}),encoding='utf-8')
            self.assertEqual(monitor.read_regular(p,100),{'valid':True})
            with self.assertRaises(ValueError): monitor.read_regular(p,2)
            p.write_text('invalid',encoding='utf-8')
            with self.assertRaises(ValueError): monitor.read_regular(p,100)

if __name__ == '__main__': unittest.main()
