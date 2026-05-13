import re
from typing import Any

import numpy as np

from .image_utils import is_blank_cell
from .ocr_engine import get_ocr_engine, get_table_ocr_engine
from .table_layout import get_table_layout


MARK_SIX_NUMBERS = [f"{index:02d}" for index in range(1, 50)]
FAST_CONFIDENCE_THRESHOLD = 0.95
VERIFY_MIN_CONFIDENCE = 0.55


def amount_cell_rect(image: np.ndarray, number: str) -> tuple[int, int, int, int]:
    height, width = image.shape[:2]
    layout = get_table_layout()
    value = int(number)
    group_index = min(3, (value - 1) // 12)
    row_index = value - 37 if group_index == 3 else (value - 1) % 12

    table_x = width * layout["tableX"]
    table_y = height * layout["tableY"]
    group_width = width * layout["groupWidth"]
    number_column_width = width * layout["numberColumnWidth"]
    row_height = height * layout["rowHeight"]
    padding_x = width * layout["paddingX"]
    padding_y = height * layout["paddingY"]

    source_x = table_x + group_index * group_width + number_column_width + padding_x
    source_y = table_y + row_index * row_height + padding_y
    source_width = group_width - number_column_width - padding_x * layout["sourceWidthPaddingMultiplier"]
    source_height = row_height - padding_y * layout["sourceHeightPaddingMultiplier"]

    x1 = max(0, int(round(source_x)))
    y1 = max(0, int(round(source_y)))
    x2 = min(width, int(round(source_x + source_width)))
    y2 = min(height, int(round(source_y + source_height)))
    return x1, y1, x2, y2


def crop_amount_cell(image: np.ndarray, number: str) -> np.ndarray:
    x1, y1, x2, y2 = amount_cell_rect(image, number)
    return image[y1:y2, x1:x2]


def _extract_text_items(result: Any) -> list[tuple[str, float]]:
    items: list[tuple[str, float]] = []
    if result is None:
        return items

    if isinstance(result, dict):
        result_items = result.get("txts") or result.get("texts")
        scores = result.get("scores") or result.get("rec_scores")
        if result_items is not None:
            if isinstance(result_items, str):
                result_items = [result_items]
            return [
                (str(text), float(scores[index]) if scores is not None and index < len(scores) else 0.0)
                for index, text in enumerate(result_items)
            ]

    result_items = getattr(result, "txts", None)
    scores = getattr(result, "scores", None)
    if result_items is not None:
        if isinstance(result_items, str):
            result_items = [result_items]
        return [
            (str(text), float(scores[index]) if scores is not None and index < len(scores) else 0.0)
            for index, text in enumerate(result_items)
        ]

    if isinstance(result, tuple) and result:
        result = result[0]

    if isinstance(result, list):
        for item in result:
            if not item:
                continue
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                text_part = item[1]
                if isinstance(text_part, (list, tuple)) and text_part:
                    text = str(text_part[0])
                    confidence = float(text_part[1]) if len(text_part) > 1 else 0.0
                    items.append((text, confidence))
                else:
                    items.append((str(text_part), 0.0))
    return items


def _recognize_cell(engine: Any, prepared: np.ndarray) -> list[tuple[str, float]]:
    try:
        result = engine(prepared, use_det=False, use_cls=False, use_rec=True)
    except TypeError:
        result = engine(prepared)
    return _extract_text_items(result)


def _extract_positioned_text(result: Any) -> list[tuple[str, float, float, float]]:
    boxes = getattr(result, "boxes", None)
    txts = getattr(result, "txts", None)
    scores = getattr(result, "scores", None)
    if boxes is None or txts is None:
        return []

    items: list[tuple[str, float, float, float]] = []
    for index, (box, text) in enumerate(zip(boxes, txts)):
        points = np.asarray(box, dtype=float)
        if points.ndim != 2 or points.shape[1] < 2:
            continue
        score = float(scores[index]) if scores is not None and index < len(scores) else 0.0
        center_x = float(points[:, 0].mean())
        center_y = float(points[:, 1].mean())
        items.append((str(text), score, center_x, center_y))
    return items


def _clean_amount(text: str) -> str:
    normalized = (
        text.replace("O", "0")
        .replace("o", "0")
        .replace("I", "1")
        .replace("l", "1")
        .replace("|", "1")
        .replace("S", "5")
        .replace("s", "5")
    )
    digits = re.sub(r"\D+", "", normalized)
    if not digits:
        return ""
    amount = int(digits)
    if amount <= 0 or amount > 9999:
        return ""
    return str(amount)


def _recognize_cell_amount(engine: Any, cell: np.ndarray) -> tuple[str, float]:
    best_amount = ""
    best_score = 0.0
    for text, score in _recognize_cell(engine, cell):
        amount = _clean_amount(text)
        if not amount:
            continue
        if score >= best_score or len(amount) > len(best_amount):
            best_amount = amount
            best_score = score
    return best_amount, best_score


def _format_bets_as_text(bets: dict[str, str]) -> str:
    grouped: dict[str, list[str]] = {}
    for number in MARK_SIX_NUMBERS:
        amount = bets.get(number)
        if not amount:
            continue
        grouped.setdefault(amount, []).append(str(int(number)))

    parts = []
    for amount, numbers in grouped.items():
        number_text = "号".join(numbers) + "号"
        parts.append(f"{number_text}一个号各下{amount}元")
    return "，".join(parts)


def _recognize_full_table(image: np.ndarray) -> tuple[dict[str, str], dict[str, float]]:
    engine = get_table_ocr_engine()
    result = engine(image)
    rects = {number: amount_cell_rect(image, number) for number in MARK_SIX_NUMBERS}
    bets: dict[str, str] = {}
    confidence: dict[str, float] = {}

    for text, score, center_x, center_y in _extract_positioned_text(result):
        amount = _clean_amount(text)
        if not amount:
            continue

        for number, (x1, y1, x2, y2) in rects.items():
            if x1 - 6 <= center_x <= x2 + 6 and y1 - 6 <= center_y <= y2 + 6:
                current_score = confidence.get(number, -1.0)
                current_amount = bets.get(number, "")
                if score >= current_score or len(amount) > len(current_amount):
                    bets[number] = amount
                    confidence[number] = round(score, 4)
                break

    return bets, confidence


def recognize_table(image: np.ndarray) -> dict[str, Any]:
    bets, confidence = _recognize_full_table(image)
    verify_engine = get_ocr_engine()
    low_confidence: list[dict[str, Any]] = []

    for number in MARK_SIX_NUMBERS:
        cell = crop_amount_cell(image, number)
        if cell.size == 0 or is_blank_cell(cell):
            continue

        current_score = confidence.get(number, 0.0)
        should_verify = number not in bets or current_score < FAST_CONFIDENCE_THRESHOLD
        if not should_verify:
            continue

        best_amount, best_score = _recognize_cell_amount(verify_engine, cell)
        if not best_amount or best_score < VERIFY_MIN_CONFIDENCE:
            continue

        if best_score >= current_score or len(best_amount) > len(bets.get(number, "")):
            bets[number] = best_amount
            confidence[number] = round(best_score, 4)

    for number in MARK_SIX_NUMBERS:
        score = confidence.get(number, 0.0)
        amount = bets.get(number)
        if amount and score < 0.85:
            low_confidence.append(
                {
                    "number": number,
                    "amount": amount,
                    "confidence": round(score, 4),
                }
            )

    return {
        "ok": True,
        "bets": bets,
        "text": _format_bets_as_text(bets),
        "confidence": confidence,
        "lowConfidence": low_confidence,
    }
