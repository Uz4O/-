import unittest

import cv2
import numpy as np

from ocr_service.image_utils import constrain_image_for_ocr, crop_wechat_bubbles, enhance_chat_text_image


class OcrImageConstraintTest(unittest.TestCase):
    def test_downscales_images_that_exceed_pixel_budget(self):
        image = np.zeros((5000, 3000, 3), dtype=np.uint8)

        constrained = constrain_image_for_ocr(image, max_side=3200, max_pixels=8_000_000)

        height, width = constrained.shape[:2]
        self.assertLessEqual(max(height, width), 3200)
        self.assertLessEqual(height * width, 8_000_000)
        self.assertEqual(constrained.shape[2], 3)

    def test_leaves_normal_screenshots_unchanged(self):
        image = np.zeros((422, 1320, 3), dtype=np.uint8)

        constrained = constrain_image_for_ocr(image, max_side=3200, max_pixels=8_000_000)

        self.assertIs(constrained, image)


class ChatImageProcessingTest(unittest.TestCase):
    def test_enhances_chat_text_by_upscaling_small_crops(self):
        image = np.full((120, 320, 3), 240, dtype=np.uint8)

        enhanced = enhance_chat_text_image(image)

        self.assertGreater(enhanced.shape[0], image.shape[0])
        self.assertGreater(enhanced.shape[1], image.shape[1])
        self.assertEqual(enhanced.shape[2], 3)

    def test_crops_green_wechat_bubbles_in_reading_order(self):
        image = np.full((620, 420, 3), 40, dtype=np.uint8)
        bubble_color = (95, 245, 105)
        cv2.rectangle(image, (80, 80), (340, 155), bubble_color, -1)
        cv2.rectangle(image, (30, 250), (320, 350), bubble_color, -1)
        cv2.rectangle(image, (260, 470), (385, 530), bubble_color, -1)
        cv2.rectangle(image, (360, 95), (392, 130), bubble_color, -1)

        crops = crop_wechat_bubbles(image)

        self.assertEqual(len(crops), 3)
        self.assertLess(crops[0].top, crops[1].top)
        self.assertLess(crops[1].top, crops[2].top)
        self.assertGreaterEqual(crops[0].image.shape[0], 75)
        self.assertGreaterEqual(crops[0].image.shape[1], 260)
        self.assertGreater(crops[2].image.shape[1], 120)


if __name__ == "__main__":
    unittest.main()
