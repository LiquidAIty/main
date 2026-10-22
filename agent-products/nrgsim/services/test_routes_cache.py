"""Deterministic Project-lock/cache tests; not SDK or simulation acceptance."""
# Entity: Building Modeling
# Relationship: Proves queued inspector state requests reuse the first accepted refresh while source/model changes invalidate it.
import concurrent.futures
import hashlib
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import routes


class StateCacheTests(unittest.TestCase):
    def test_queued_refresh_rechecks_cache_and_source_changes_invalidate(self):
        with tempfile.TemporaryDirectory() as folder:
            product=Path(folder); project='38bd1429-e8e1-47ff-afef-d940aa8e8040'
            root=product/'.local/projects'/project
            (root/'inputs').mkdir(parents=True); (product/'services').mkdir()
            source=product/'services/owner.py'; source.write_text('# owner')
            config=product/'workspace.local.json'
            config.write_text(json.dumps(dict(projectId=project,referenceRoot=str(product))))
            python=product/'runtime/mcp-venv/Scripts/python.exe'; python.parent.mkdir(parents=True); python.touch()
            model=root/'inputs/baseline.osm'; model.write_text('test-only bytes')
            data=dict(configured=True,cases=[dict(id='baseline',revision=hashlib.sha256(model.read_bytes()).hexdigest())])
            entered=threading.Event(); release=threading.Event()
            def worker(*args,**kwargs):
                entered.set(); self.assertTrue(release.wait(5))
                return SimpleNamespace(returncode=0,stdout='NRGSIM_RESULT='+json.dumps(dict(ok=True,data=data)))
            with patch.object(routes,'ROOT',product),patch.object(routes,'CONFIG',config),patch.object(routes,'_locks',{}),patch.object(routes.subprocess,'run',side_effect=worker) as run:
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                    first=pool.submit(routes.execute,project,dict(operation='state'))
                    self.assertTrue(entered.wait(5))
                    second=pool.submit(routes.execute,project,dict(operation='state'))
                    release.set()
                    self.assertEqual(first.result(5),data); self.assertEqual(second.result(5),data)
                self.assertEqual(run.call_count,1)
                self.assertEqual(routes.cached_state(root),data)
                model.write_text('changed model')
                self.assertIsNone(routes.cached_state(root))
                model.write_text('test-only bytes')
                import os
                later=(root/'state.json').stat().st_mtime+2
                os.utime(source,(later,later))
                self.assertIsNone(routes.cached_state(root))


if __name__=='__main__': unittest.main()
