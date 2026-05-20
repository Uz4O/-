import os
import re
from typing import Any

import numpy as np

from .image_utils import crop_wechat_bubbles, enhance_chat_text_image
from .ocr_engine import get_ocr_engine


CHAT_KEYWORDS = (
    "各下|各押|各买|一个号|每号|每组|平码|平马|平特|特码|连码|复试|复式|"
    "二中二|二中三|三中三|复四三|鼠|牛|虎|兔|龙|蛇|马|羊|猴|鸡|狗|猪"
)


def _extract_lines(result: Any) -> list[str]:
    lines: list[tuple[float, float, str]] = []
    if result is None:
        return []

    boxes = getattr(result, "boxes", None)
    txts = getattr(result, "txts", None)
    if boxes is not None and txts is not None:
        for box, text in zip(boxes, txts):
            if not str(text).strip():
                continue
            points = np.asarray(box, dtype=float)
            y = float(points[:, 1].mean()) if points.ndim == 2 else 0.0
            x = float(points[:, 0].mean()) if points.ndim == 2 else 0.0
            lines.append((y, x, str(text)))
    elif isinstance(result, tuple) and result:
        return _extract_lines(result[0])
    elif isinstance(result, list):
        for item in result:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                text_part = item[1]
                text = str(text_part[0] if isinstance(text_part, (list, tuple)) and text_part else text_part)
                if not text.strip():
                    continue
                try:
                    points = np.asarray(item[0], dtype=float)
                    y = float(points[:, 1].mean())
                    x = float(points[:, 0].mean())
                except Exception:
                    y = 0.0
                    x = 0.0
                lines.append((y, x, text))

    lines.sort(key=lambda item: (round(item[0] / 12), item[1]))
    merged: list[str] = []
    current_y: float | None = None
    current: list[str] = []
    for y, _x, text in lines:
        if current_y is None or abs(y - current_y) <= 14:
            current.append(text)
            current_y = y if current_y is None else (current_y + y) / 2
        else:
            merged.append(" ".join(current))
            current = [text]
            current_y = y
    if current:
        merged.append(" ".join(current))
    return merged


def _is_bet_content_line(line: str) -> bool:
    return bool(re.search(rf"(\d+[./]\d+|\d+号|{CHAT_KEYWORDS})", line))


def _is_bet_continuation_line(line: str, previous_line: str) -> bool:
    if not previous_line:
        return False

    if re.fullmatch(r"\d{1,4}元?", line) and re.search(r"(各下|各押|各买|一个号|每组|出)\D*$", previous_line):
        return True

    if re.fullmatch(r"\d{1,2}", line) and re.search(r"/\d{1,2}$", previous_line):
        return True

    if re.fullmatch(r"(?:[./]?\d{1,2}){2,}", line) and re.search(r"(\.\d|/\d*)$", previous_line):
        return True

    return False


def _is_chat_ui_noise_line(line: str) -> bool:
    if "文件传输助手" in line:
        return True

    if re.fullmatch(r"\d{1,2}:\d{2}(?:[.:]\d{1,3})?", line):
        return True

    if re.fullmatch(r"\d{1,2}:\d{2}[.:]\d{1,3}", re.sub(r"\s+", "", line)):
        return True

    if re.fullmatch(r"(?:凌晨|上午|下午|晚上)?\d{1,2}:\d{2}", line):
        return True

    return False


def _normalize_compact_mark_six_numbers(line: str) -> str:
    def normalize_three_digit_tokens(value: str) -> str:
        parts = value.split(" ")
        fixed: list[str] = []
        for part in parts:
            match = re.fullmatch(r"(\d{3})(\D*)", part)
            if match and fixed:
                digits, suffix = match.groups()
                previous_digits = re.sub(r"\D+", "", fixed[-1])
                candidate = digits[1:]
                if previous_digits.endswith(digits[0]) and 1 <= int(candidate) <= 49:
                    fixed.append(f"{candidate}{suffix}")
                    continue
            fixed.append(part)
        return " ".join(fixed)

    def valid_numbers(digits: str) -> list[str]:
        numbers = [digits[index : index + 2] for index in range(0, len(digits), 2)]
        return numbers if all(1 <= int(number) <= 49 for number in numbers) else []

    def remove_single_duplicate_digit(digits: str) -> str:
        candidates = set()
        for index in range(1, len(digits)):
            if digits[index] != digits[index - 1]:
                continue
            candidate = digits[:index] + digits[index + 1 :]
            if len(candidate) % 2 == 0 and valid_numbers(candidate):
                candidates.add(candidate)
        return next(iter(candidates)) if len(candidates) == 1 else ""

    def expand(match: re.Match[str]) -> str:
        digits = match.group("digits")
        next_number = match.group("next")
        if len(digits) < 4:
            return match.group(0)

        number_digits = digits
        separator = ""
        suffix = ""
        if len(number_digits) % 2 == 0:
            separator = match.group("gap") or ""
            suffix = next_number or ""
        else:
            duplicated_digit_fix = remove_single_duplicate_digit(number_digits)
            if duplicated_digit_fix:
                number_digits = duplicated_digit_fix
                separator = match.group("gap") or ""
                suffix = next_number or ""
            else:
                if not next_number or number_digits[-1] != next_number[0]:
                    return match.group(0)
                number_digits = number_digits[:-1]
                separator = match.group("gap")
                suffix = next_number

        numbers = valid_numbers(number_digits)
        if not numbers:
            return match.group(0)

        return " ".join(numbers) + (f"{separator}{suffix}" if suffix else "")

    expanded = re.sub(r"(?P<digits>\d{4,})(?:(?P<gap>[ \t]+)(?P<next>\d{2})(?=\D|$))?", expand, line)
    return normalize_three_digit_tokens(expanded)


def clean_chat_text(text: str) -> str:
    cleaned_lines = []
    previous_kept_line = ""
    for line in text.splitlines():
        normalized = (
            line.replace("|", "/")
            .replace("；", ":")
            .replace("、", ".")
            .replace("，", ",")
        )
        normalized = re.sub(r"\s+", " ", normalized).strip()
        compact_line = re.sub(r"\s+", "", normalized)
        if not compact_line:
            continue
        if _is_chat_ui_noise_line(compact_line) or _is_chat_ui_noise_line(normalized):
            continue
        if compact_line == "0" and not _is_bet_continuation_line(compact_line, previous_kept_line):
            continue
        if _is_bet_content_line(compact_line) or _is_bet_continuation_line(compact_line, previous_kept_line):
            cleaned_lines.append(_normalize_compact_mark_six_numbers(normalized))
            previous_kept_line = compact_line
    return "\n".join(cleaned_lines)


def _score_cleaned_chat_text(text: str) -> tuple[int, int, int]:
    lines = [line for line in text.splitlines() if line.strip()]
    digit_count = sum(ch.isdigit() for ch in text)
    keyword_count = len(re.findall(CHAT_KEYWORDS, text))
    return (len(lines), keyword_count, digit_count)


def select_best_chat_ocr_result(results: list[dict[str, str]]) -> dict[str, str | bool | int]:
    best: dict[str, str | bool | int] | None = None
    best_score = (-1, -1, -1)

    for result in results:
        raw_text = str(result.get("rawText", ""))
        cleaned_text = clean_chat_text(raw_text)
        score = _score_cleaned_chat_text(cleaned_text)
        if score > best_score:
            best_score = score
            best = {
                "ok": True,
                "variant": str(result.get("variant", "original")),
                "text": cleaned_text,
                "rawText": raw_text,
                "ocrVariants": len(results),
            }

    return best or {
        "ok": True,
        "variant": "original",
        "text": "",
        "rawText": "",
        "ocrVariants": 0,
    }


def _stack_chat_bubbles(image: np.ndarray) -> np.ndarray | None:
    crops = crop_wechat_bubbles(image)
    if not crops:
        return None

    max_width = max(crop.image.shape[1] for crop in crops)
    separator = 18
    total_height = sum(crop.image.shape[0] for crop in crops) + separator * (len(crops) - 1)
    stacked = np.full((total_height, max_width, 3), 255, dtype=np.uint8)

    y = 0
    for crop in crops:
        crop_height, crop_width = crop.image.shape[:2]
        stacked[y : y + crop_height, 0:crop_width] = crop.image
        y += crop_height + separator

    return stacked


def _recognize_chat_bubbles(engine: Any, image: np.ndarray, *, enhanced: bool = False) -> str:
    stacked = _stack_chat_bubbles(image)
    if stacked is None:
        return ""
    recognize_image = enhance_chat_text_image(stacked) if enhanced else stacked
    return "\n".join(_extract_lines(engine(recognize_image)))


def recognize_chat(image: np.ndarray) -> dict[str, str | bool]:
    engine = get_ocr_engine()
    results = [
        {"variant": "original", "rawText": "\n".join(_extract_lines(engine(image)))},
    ]

    if os.getenv("OCR_CHAT_ENHANCED_VARIANT", "0") == "1":
        enhanced = enhance_chat_text_image(image)
        results.append({"variant": "enhanced", "rawText": "\n".join(_extract_lines(engine(enhanced)))})

    if os.getenv("OCR_CHAT_BUBBLE_VARIANT", "1") != "0":
        bubble_text = _recognize_chat_bubbles(engine, image)
        if bubble_text:
            results.append({"variant": "bubbles", "rawText": bubble_text})

        if os.getenv("OCR_CHAT_BUBBLE_ENHANCED_VARIANT", "0") == "1":
            enhanced_bubble_text = _recognize_chat_bubbles(engine, image, enhanced=True)
            if enhanced_bubble_text:
                results.append({"variant": "bubbles-enhanced", "rawText": enhanced_bubble_text})

    return select_best_chat_ocr_result(results)
