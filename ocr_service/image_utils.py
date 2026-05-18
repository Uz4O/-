import base64
import re

import cv2
import numpy as np


def decode_image_base64(image_base64: str) -> np.ndarray:
    payload = re.sub(r"^data:image/[^;]+;base64,", "", image_base64.strip())
    raw = base64.b64decode(payload, validate=False)
    buffer = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("图片数据无法解码")
    return image


def preprocess_digit_cell(cell: np.ndarray) -> np.ndarray:
    scale = 4
    cell = cv2.resize(cell, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    binary = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        12,
    )
    return cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)


def enhance_chat_text_image(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    scale = 2.0 if min(height, width) < 1400 else 1.5
    enlarged = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(enlarged, cv2.COLOR_BGR2GRAY)
    gray = cv2.fastNlMeansDenoising(gray, None, h=8, templateWindowSize=7, searchWindowSize=21)
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    blurred = cv2.GaussianBlur(gray, (0, 0), 1.0)
    sharpened = cv2.addWeighted(gray, 1.65, blurred, -0.65, 0)
    return cv2.cvtColor(sharpened, cv2.COLOR_GRAY2BGR)


def is_blank_cell(cell: np.ndarray) -> bool:
    gray = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 205, 255, cv2.THRESH_BINARY_INV)
    ink_ratio = float(np.count_nonzero(binary)) / float(binary.size)
    dark_ratio = float(np.count_nonzero(gray < 135)) / float(gray.size)
    return ink_ratio < 0.012 and dark_ratio < 0.004
