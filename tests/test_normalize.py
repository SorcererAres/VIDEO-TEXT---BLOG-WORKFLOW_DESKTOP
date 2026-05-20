from __future__ import annotations

import unittest

from video2blog import transcript


class NormalizeTests(unittest.TestCase):
    def test_normalize_txt_collapses_spaces_and_sentence_lines(self) -> None:
        text = "  第一句   结束。\n第二句 continues\nwithout punctuation\n\n\n第三句！"
        self.assertEqual(
            transcript.normalize_txt(text),
            "第一句 结束。\n第二句 continues without punctuation\n第三句！",
        )

    def test_transcript_text_from_timed_text_removes_srt_noise(self) -> None:
        text = """WEBVTT

1
00:00:00,000 --> 00:00:01,000
你好。

2
00:00:01.000 --> 00:00:02.000
世界！
"""
        self.assertEqual(transcript.transcript_text_from_timed_text(text), "你好。\n世界！")

    def test_segments_to_srt_formats_timestamps_and_skips_empty_text(self) -> None:
        body = transcript.segments_to_srt(
            [
                {"start": 0, "end": 1.25, "text": " hello "},
                {"start": 2, "end": 3, "text": " "},
                {"start": 3661.5, "end": 3662.0, "text": "world"},
            ]
        )
        self.assertEqual(
            body,
            "1\n00:00:00,000 --> 00:00:01,250\nhello\n\n"
            "2\n01:01:01,500 --> 01:01:02,000\nworld\n\n",
        )


if __name__ == "__main__":
    unittest.main()
