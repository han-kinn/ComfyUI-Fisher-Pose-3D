import base64
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("duf_library", Path(__file__).resolve().parents[1] / "duf_library.py")
duf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(duf)

def sample(value=42):
    return json.dumps({"scene": {"animations": [{"url": "name://@selection/lShldrBend:?rotation/y/value", "keys": [[1, 50], [0, value]]}]}}).encode()

class DufTests(unittest.TestCase):
    def test_plain_gzip_and_frame(self):
        for raw in [sample(), gzip.compress(sample()), b"\xef\xbb\xbf" + sample()]:
            self.assertEqual(duf.read_duf(raw)["channels"]["lShldrBend"]["y"], 42)

    def test_bad_inputs(self):
        for raw in [b"{}", b"[]", b"broken", sample(float("nan")), gzip.compress(b" " * (duf.MAX_BYTES+1))]:
            with self.assertRaises(ValueError): duf.read_duf(raw)

    def test_node_channels(self):
        raw = json.dumps({"node_library": [{"id":"hip", "rotation_order":"ZXY", "rotation":[{"id":"x", "value":12}]}]}).encode()
        self.assertEqual(duf.read_duf(raw)["metadata"]["hip"]["rotation_order"], "ZXY")

    def test_figure_root_is_not_a_second_person(self):
        data = json.loads(sample())
        data["scene"]["animations"].append({"url":"name://@selection:?rotation/z/value", "keys":[[0,25]]})
        pose = duf.read_duf(json.dumps(data).encode())
        self.assertEqual(pose["channels"]["__figure__"]["z"],25)
        self.assertEqual(pose["channels"]["lShldrBend"]["y"],42)

    def test_multi_figure_rejected(self):
        data = json.loads(sample())
        data["scene"]["animations"].append({"url":"name://other/lShldrBend:?rotation/y/value", "keys":[[0,12]]})
        with self.assertRaises(ValueError): duf.read_duf(json.dumps(data).encode())

    def test_persistence_dedup_delete_and_path(self):
        with tempfile.TemporaryDirectory() as folder:
            lib = duf.DufLibrary(folder)
            entry = lib.add("pose.duf", sample())
            self.assertEqual(entry["id"], lib.add("renamed.duf",sample())["id"])
            second = duf.DufLibrary(folder)
            self.assertEqual(len(second.listing()), 1)
            self.assertEqual(base64.b64decode(second.get(entry["id"])["source"]), sample())
            with self.assertRaises(ValueError): lib.get("../../outside")
            with self.assertRaises(ValueError): lib.thumbnail(entry["id"], "data:text/html,hello")
            lib.delete(entry["id"])
            self.assertEqual(second.listing(), [])

if __name__ == '__main__': unittest.main()
