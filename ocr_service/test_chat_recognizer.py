import unittest


from ocr_service.chat_recognizer import clean_chat_text, select_best_chat_ocr_result


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

    def test_keeps_split_amount_continuation_lines(self):
        raw_text = "\n".join(
            [
                "澳门彩特码10号12号14号24号26号32号",
                "10元,4号14号24号34号44号个号各下",
                "100元,5号15号25号35号45号个号各下",
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


if __name__ == "__main__":
    unittest.main()
