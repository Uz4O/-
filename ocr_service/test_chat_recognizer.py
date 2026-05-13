import unittest


from ocr_service.chat_recognizer import clean_chat_text


class CleanChatTextTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
