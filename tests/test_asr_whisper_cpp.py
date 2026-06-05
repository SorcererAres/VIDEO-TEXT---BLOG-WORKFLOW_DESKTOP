from __future__ import annotations

import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from video2blog.asr import whisper_cpp


class WhisperCppTests(unittest.TestCase):
    def test_transcribe_audio_whisper_cpp_reads_generated_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            model = root / "ggml.bin"
            wav = root / "audio.wav"
            model.write_text("model", encoding="utf-8")
            wav.write_text("wav", encoding="utf-8")

            def fake_run(cmd, **kwargs):  # noqa: ANN001, ANN202
                out_prefix = Path(cmd[cmd.index("-of") + 1])
                Path(f"{out_prefix}.txt").write_text(" hello  world。", encoding="utf-8")
                return types.SimpleNamespace(returncode=0, stdout="", stderr="")

            with (
                mock.patch.object(
                    whisper_cpp, "resolve_whisper_cpp_bin", return_value="/bin/whisper-cli"
                ),
                mock.patch.object(whisper_cpp.subprocess, "run", side_effect=fake_run),
            ):
                result = whisper_cpp.transcribe_audio_whisper_cpp(
                    wav,
                    model_path=model,
                    whisper_cpp_bin=None,
                )

            self.assertEqual(result["text"], "hello world。")
            self.assertIn("00:00:00,000 --> 00:00:07,500", result["srt"])
            self.assertEqual(result["engine_meta"]["binary"], "/bin/whisper-cli")

    def test_transcribe_audio_whisper_cpp_requires_model(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "缺少 whisper.cpp 模型"):
            whisper_cpp.transcribe_audio_whisper_cpp(
                Path("audio.wav"),
                model_path=None,
                whisper_cpp_bin=None,
            )

    def test_transcribe_audio_whisper_cpp_reports_process_failure(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            model = root / "ggml.bin"
            wav = root / "audio.wav"
            model.write_text("model", encoding="utf-8")
            wav.write_text("wav", encoding="utf-8")
            with (
                mock.patch.object(
                    whisper_cpp, "resolve_whisper_cpp_bin", return_value="/bin/whisper-cli"
                ),
                mock.patch.object(
                    whisper_cpp.subprocess,
                    "run",
                    return_value=types.SimpleNamespace(returncode=1, stdout="", stderr="boom"),
                ),
            ):
                with self.assertRaisesRegex(RuntimeError, "boom"):
                    whisper_cpp.transcribe_audio_whisper_cpp(
                        wav,
                        model_path=model,
                        whisper_cpp_bin=None,
                    )


if __name__ == "__main__":
    unittest.main()
