from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from video2blog.output import output_paths, write_meta


class MetaTests(unittest.TestCase):
    def test_output_paths_uses_default_or_override_root(self) -> None:
        video = Path("/tmp/source/video.mp4")
        self.assertEqual(output_paths(video, None, Path("/repo/work")), Path("/repo/work/video"))
        self.assertEqual(output_paths(video, Path("/tmp/out"), Path("/repo/work")), Path("/tmp/out/video"))

    def test_write_meta_records_raw_stage(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            meta = root / "meta.json"
            write_meta(
                meta,
                video=root / "video.mp4",
                txt_path=root / "raw.txt",
                srt_path=root / "raw.srt",
                log_path=root / "raw.log",
                engine_meta={"engine": "external", "nested": {"path": root}},
                engine_requested="external",
                fallback_policy="stop",
                execution_context="test",
            )
            data = json.loads(meta.read_text(encoding="utf-8"))
            self.assertEqual(data["engine"], "external")
            self.assertEqual(data["engine_requested"], "external")
            self.assertEqual(data["stages"]["raw"]["tool"], "video2blog.py")
            self.assertEqual(data["nested"]["path"], str(root))


if __name__ == "__main__":
    unittest.main()
