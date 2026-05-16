import unittest


from ocr_service.table_recognizer import looks_like_chat_screenshot_text


class TableRecognizerGuardTest(unittest.TestCase):
    def test_detects_chat_screenshot_text_before_table_amount_mapping(self):
        raw_text = "\n".join(
            [
                "1:10 . 654",
                "1 文件传输助手",
                "123508/250",
                "4603192741062214/150",
                "澳门彩特码07号16号28号33号",
                "45号一个号各下30元",
                "03.12.29",
                "15.27.44三中三每组35",
            ]
        )

        self.assertTrue(looks_like_chat_screenshot_text(raw_text))

    def test_does_not_treat_plain_table_amount_text_as_chat(self):
        raw_text = "10 20 50 100 300"

        self.assertFalse(looks_like_chat_screenshot_text(raw_text))

    def test_does_not_treat_table_title_keyword_alone_as_chat(self):
        raw_text = "特码 投注表 01 02 03 04"

        self.assertFalse(looks_like_chat_screenshot_text(raw_text))


if __name__ == "__main__":
    unittest.main()
