import unittest
from pathlib import Path

import cv2

from ocr_service.chat_recognizer import clean_chat_text, recognize_chat, select_best_chat_ocr_result


FIXTURE_DIR = Path(__file__).resolve().parents[1] / "test-assets"


class CleanChatTextTest(unittest.TestCase):
    def test_preserves_spaces_between_bet_numbers(self):
        raw_text = "\n".join(
            [
                "12 35 08/250",
                "46 03 19 27 41 06 22 14/150",
                "09 31 44 18 25/100",
            ]
        )

        self.assertEqual(clean_chat_text(raw_text).splitlines(), raw_text.splitlines())

    def test_restores_spaces_in_compact_ocr_bet_numbers(self):
        raw_text = "\n".join(
            [
                "1235 08/250",
                "4603192741062214/150",
                "0931441825/100",
                "0617293240052137441226",
                "08153049/150",
            ]
        )

        self.assertEqual(
            clean_chat_text(raw_text).splitlines(),
            [
                "12 35 08/250",
                "46 03 19 27 41 06 22 14/150",
                "09 31 44 18 25/100",
                "06 17 29 32 40 05 21 37 44 12 26",
                "08 15 30 49/150",
            ],
        )

    def test_drops_wechat_ui_noise_lines(self):
        raw_text = "\n".join(
            [
                "1:10 . 654",
                "1 文件传输助手",
                "123508/250",
                "0",
            ]
        )

        self.assertEqual(clean_chat_text(raw_text).splitlines(), ["12 35 08/250"])

    def test_restores_spaces_when_ocr_duplicates_next_number_prefix(self):
        raw_text = "4603192 27 41 06 22 14/150"

        self.assertEqual(clean_chat_text(raw_text).splitlines(), ["46 03 19 27 41 06 22 14/150"])

    def test_restores_spaces_when_ocr_inserts_duplicate_digit_inside_compact_run(self):
        raw_text = "46031922741062214/150"

        self.assertEqual(clean_chat_text(raw_text).splitlines(), ["46 03 19 27 41 06 22 14/150"])

    def test_removes_inserted_duplicate_prefix_from_three_digit_number_token(self):
        raw_text = "03 318 29 41/100"

        self.assertEqual(clean_chat_text(raw_text).splitlines(), ["03 18 29 41/100"])

    def test_keeps_split_amount_continuation_lines(self):
        raw_text = "\n".join(
            [
                "澳门彩特码10号12号14号24号26号32号",
                "10元4号14号24号34号44号一个号各下",
                "100元5号15号25号35号45号一个号各下",
                "70元",
            ]
        )

        self.assertEqual(clean_chat_text(raw_text).splitlines(), raw_text.splitlines())

    def test_keeps_split_slash_amount_digits(self):
        raw_text = "\n".join(
            [
                "12...48..07/250..46..44..08.16.22..30.02..28",
                "..06..20...40..26.05..29..07..21..32..24.36/15",
                "0",
            ]
        )

        self.assertEqual(clean_chat_text(raw_text).splitlines(), raw_text.splitlines())

    def test_prefers_enhanced_result_when_it_has_more_bet_lines(self):
        original = "文件传输助手\n10号20号各下"
        enhanced = "文件传输助手\n10号20号各下50元\n03.17.39三中三每组40"

        best = select_best_chat_ocr_result(
            [
                {"variant": "original", "rawText": original},
                {"variant": "enhanced", "rawText": enhanced},
            ]
        )

        self.assertEqual(best["variant"], "enhanced")
        self.assertEqual(best["text"].splitlines(), ["10号20号各下50元", "03.17.39三中三每组40"])
        self.assertEqual(best["ocrVariants"], 2)


    def test_prefers_bubble_crop_result_when_it_has_more_bet_lines(self):
        original = "123508/250"
        bubbles = "123508/250\n4603192741062214/150"

        best = select_best_chat_ocr_result(
            [
                {"variant": "original", "rawText": original},
                {"variant": "bubbles", "rawText": bubbles},
            ]
        )

        self.assertEqual(best["variant"], "bubbles")
        self.assertEqual(best["ocrVariants"], 2)


class ChatScreenshotRecognitionTest(unittest.TestCase):
    def recognize_fixture(self, filename: str) -> str:
        image_path = FIXTURE_DIR / filename
        if not image_path.exists():
            self.skipTest(f"missing OCR fixture: {image_path}")
        image = cv2.imread(str(image_path))
        self.assertIsNotNone(image, f"failed to read OCR fixture: {image_path}")
        result = recognize_chat(image)
        return str(result["text"])

    def test_recognizes_first_chat_screenshot_critical_numbers(self):
        text = self.recognize_fixture("chat-sample-1.jpg")

        self.assertIn("01 14 28/200", text)
        self.assertIn("08 23 31 39/100", text)
        self.assertIn("22.49二中二出60", text)

    def test_recognizes_second_chat_screenshot_critical_numbers(self):
        text = self.recognize_fixture("chat-sample-2.jpg")

        self.assertIn("15 24 39/250", text)
        self.assertIn("02 11 28 34 47 05 19/120", text)
        self.assertIn("龙蛇马羊复四三各五十", text)

    def test_recognizes_third_chat_screenshot_critical_numbers(self):
        text = self.recognize_fixture("chat-sample-3.jpg")

        self.assertIn("11.28.45三中三每组30", text)
        self.assertIn("04.12.27.36.44", text)
        self.assertIn("虎兔龙蛇复四三各五十", text)


if __name__ == "__main__":
    unittest.main()
