from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from video2blog.asr import mlx


class MlxTests(unittest.TestCase):
    def test_transcribe_audio_mlx_reads_child_result(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            wav = root / "audio.wav"
            log = root / "raw.log"
            wav.write_text("wav", encoding="utf-8")
            log.write_text("", encoding="utf-8")

            class FakePopen:
                returncode = 0

                def __init__(self, cmd, **kwargs):  # noqa: ANN001
                    self.pid = 123
                    result_path = Path(cmd[5])
                    result_path.write_text(
                        json.dumps({"text": "hello", "segments": [{"start": 0, "end": 1, "text": "hello"}]}),
                        encoding="utf-8",
                    )

                def wait(self, timeout=None):  # noqa: ANN001, ANN201
                    return 0

            with mock.patch.object(mlx.subprocess, "Popen", FakePopen):
                result = mlx.transcribe_audio_mlx(
                    wav,
                    "model",
                    timeout_seconds=5,
                    work_dir=root,
                    log_path=log,
                )
            self.assertEqual(result["text"], "hello")
            self.assertEqual(result["segments"][0]["end"], 1)

    def test_transcribe_audio_mlx_terminates_on_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            wav = root / "audio.wav"
            log = root / "raw.log"
            wav.write_text("wav", encoding="utf-8")
            log.write_text("", encoding="utf-8")

            class FakePopen:
                returncode = None

                def __init__(self, cmd, **kwargs):  # noqa: ANN001
                    self.pid = 123
                    self.wait_calls = 0
                    self.terminated = False
                    self.killed = False

                def wait(self, timeout=None):  # noqa: ANN001, ANN201
                    self.wait_calls += 1
                    if self.wait_calls == 1:
                        raise subprocess.TimeoutExpired("cmd", timeout)
                    return 0

                def terminate(self) -> None:
                    self.terminated = True

                def kill(self) -> None:
                    self.killed = True

            with mock.patch.object(mlx.subprocess, "Popen", FakePopen):
                with self.assertRaisesRegex(RuntimeError, "超时"):
                    mlx.transcribe_audio_mlx(
                        wav,
                        "model",
                        timeout_seconds=1,
                        work_dir=root,
                        log_path=log,
                    )


if __name__ == "__main__":
    unittest.main()
