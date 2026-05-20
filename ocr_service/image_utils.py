import base64
from dataclasses import dataclass
import re

import cv2
import numpy as np


MAX_OCR_IMAGE_SIDE = 3200
MAX_OCR_IMAGE_PIXELS = 8_000_000


@dataclass(frozen=True)
class ChatBubbleCrop:
    image: np.ndarray
    left: int
    top: int
    right: int
    bottom: int


def decode_image_base64(image_base64: str) -> np.ndarray:
    payload = re.sub(r"^data:image/[^;]+;base64,", "", image_base64.strip())
    raw = base64.b64decode(payload, validate=False)
    buffer = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("图片数据无法解码")
    return image


def constrain_image_for_ocr(
    image: np.ndarray,
    *,
    max_side: int = MAX_OCR_IMAGE_SIDE,
    max_pixels: int = MAX_OCR_IMAGE_PIXELS,
) -> np.ndarray:
    height, width = image.shape[:2]
    if height <= 0 or width <= 0:
        return image

    side_scale = min(1.0, float(max_side) / float(max(height, width)))
    pixel_scale = min(1.0, (float(max_pixels) / float(height * width)) ** 0.5)
    scale = min(side_scale, pixel_scale)
    if scale >= 1.0:
        return image

    next_width = max(1, int(round(width * scale)))
    next_height = max(1, int(round(height * scale)))
    return cv2.resize(image, (next_width, next_height), interpolation=cv2.INTER_AREA)


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
    scale = 2.6 if min(height, width) < 700 else 2.0 if min(height, width) < 1400 else 1.5
    enlarged = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(enlarged, cv2.COLOR_BGR2GRAY)
    gray = cv2.fastNlMeansDenoising(gray, None, h=6, templateWindowSize=7, searchWindowSize=21)
    clahe = cv2.createCLAHE(clipLimit=2.6, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    blurred = cv2.GaussianBlur(gray, (0, 0), 0.9)
    sharpened = cv2.addWeighted(gray, 1.8, blurred, -0.8, 0)
    return cv2.cvtColor(sharpened, cv2.COLOR_GRAY2BGR)


def crop_wechat_bubbles(image: np.ndarray) -> list[ChatBubbleCrop]:
    height, width = image.shape[:2]
    if height <= 0 or width <= 0:
        return []

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    green_mask = cv2.inRange(hsv, np.array([35, 45, 80]), np.array([95, 255, 255]))
    green_mask[: int(height * 0.08), :] = 0
    green_mask[int(height * 0.94) :, :] = 0

    component_count, component_labels, component_stats, _ = cv2.connectedComponentsWithStats(green_mask, 8)
    for component in range(1, component_count):
        x, y, w, h, area = component_stats[component]
        aspect = float(w) / float(h) if h else 0.0
        near_side = x < width * 0.08 or x + w > width * 0.88
        avatar_sized = width * 0.035 <= w <= width * 0.12 and height * 0.015 <= h <= height * 0.06
        squareish = 0.65 <= aspect <= 1.35
        if near_side and avatar_sized and squareish and area < w * h * 0.9:
            green_mask[component_labels == component] = 0

    kernel_width = max(15, width // 30)
    kernel_height = max(9, height // 160)
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_width, kernel_height))
    green_mask = cv2.morphologyEx(green_mask, cv2.MORPH_CLOSE, close_kernel, iterations=2)
    green_mask = cv2.morphologyEx(green_mask, cv2.MORPH_OPEN, np.ones((3, 3), dtype=np.uint8), iterations=1)

    contours, _ = cv2.findContours(green_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = max(900, int(width * height * 0.003))
    min_width = max(90, int(width * 0.12))
    min_height = max(32, int(height * 0.018))
    max_avatar_width = int(width * 0.11)
    crops: list[ChatBubbleCrop] = []

    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < min_area or w < min_width or h < min_height:
            continue
        if w <= max_avatar_width and h <= max_avatar_width:
            continue

        pad_x = max(8, int(w * 0.025))
        pad_y = max(8, int(h * 0.08))
        left = max(0, x - pad_x)
        top = max(0, y - pad_y)
        right = min(width, x + w + pad_x)
        bottom = min(height, y + h + pad_y)
        if right > width * 0.94:
            avatar_cutoff = int(width * 0.88)
            if left < avatar_cutoff and avatar_cutoff - left >= min_width:
                right = avatar_cutoff
        if left < width * 0.06:
            avatar_cutoff = int(width * 0.12)
            if right > avatar_cutoff and right - avatar_cutoff >= min_width:
                left = avatar_cutoff
        crops.append(ChatBubbleCrop(image=image[top:bottom, left:right], left=left, top=top, right=right, bottom=bottom))

    crops.sort(key=lambda crop: (crop.top, crop.left))
    merged: list[ChatBubbleCrop] = []
    for crop in crops:
        if not merged:
            merged.append(crop)
            continue
        previous = merged[-1]
        overlaps_y = crop.top <= previous.bottom and previous.top <= crop.bottom
        close_y = abs(crop.top - previous.top) <= max(24, int(height * 0.015))
        if overlaps_y and close_y:
            left = min(previous.left, crop.left)
            top = min(previous.top, crop.top)
            right = max(previous.right, crop.right)
            bottom = max(previous.bottom, crop.bottom)
            merged[-1] = ChatBubbleCrop(
                image=image[top:bottom, left:right],
                left=left,
                top=top,
                right=right,
                bottom=bottom,
            )
        else:
            merged.append(crop)

    return merged


def is_blank_cell(cell: np.ndarray) -> bool:
    gray = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 205, 255, cv2.THRESH_BINARY_INV)
    ink_ratio = float(np.count_nonzero(binary)) / float(binary.size)
    dark_ratio = float(np.count_nonzero(gray < 135)) / float(gray.size)
    return ink_ratio < 0.012 and dark_ratio < 0.004
