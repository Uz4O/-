import re
from typing import Any

import numpy as np

from .ocr_engine import get_ocr_engine


def _extract_lines(result: Any) -> list[str]:
    lines: list[tuple[float, float, str]] = []
    if result is None:
        return []

    boxes = getattr(result, "boxes", None)
    txts = getattr(result, "txts", None)
    if boxes is not None and txts is not None:
        for box, text in zip(boxes, txts):
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
            merged.append("".join(current))
            current = [text]
            current_y = y
    if current:
        merged.append("".join(current))
    return merged


def _is_bet_content_line(line: str) -> bool:
    return bool(
        re.search(
            r"(\d+[./]\d+|\d+号|各下|各押|各买|一个号|每号|平码|平马|连码|复试|复式|二中二|二中三|三中三|鼠|牛|虎|兔|龙|蛇|马|羊|猴|鸡|狗|猪)",
            line,
        )
    )


def _is_bet_continuation_line(line: str, previous_line: str) -> bool:
    if not previous_line:
        return False

    if re.fullmatch(r"\d{1,4}元?", line) and re.search(r"(各下|各押|各买|下|押|买)\D*$", previous_line):
        return True

    if re.fullmatch(r"\d{1,2}", line) and re.search(r"/\d{1,2}$", previous_line):
        return True

    if re.fullmatch(r"(?:[./]?\d{1,2}){2,}", line) and re.search(r"(\.\d|/\d*)$", previous_line):
        return True

    return False


def clean_chat_text(text: str) -> str:
    cleaned_lines = []
    previous_kept_line = ""
    for line in text.splitlines():
        normalized = (
            line.replace("|", "/")
            .replace("：", ":")
            .replace("。", ".")
            .replace("，", ",")
        )
        normalized = re.sub(r"\s+", "", normalized)
        if not normalized:
            continue
        if _is_bet_content_line(normalized) or _is_bet_continuation_line(normalized, previous_kept_line):
            cleaned_lines.append(normalized)
            previous_kept_line = normalized
    return "\n".join(cleaned_lines)


def recognize_chat(image: np.ndarray) -> dict[str, str | bool]:
    engine = get_ocr_engine()
    result = engine(image)
    raw_text = "\n".join(_extract_lines(result))
    return {
        "ok": True,
        "text": clean_chat_text(raw_text),
        "rawText": raw_text,
    }
