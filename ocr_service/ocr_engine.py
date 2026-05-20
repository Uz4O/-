from dataclasses import dataclass
from functools import lru_cache
import os
from typing import Any

import numpy as np
from paddleocr import PaddleOCR


os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")


@dataclass
class OcrResult:
    boxes: list[Any]
    txts: list[str]
    scores: list[float]


class PaddleOcrEngine:
    def __init__(self, *, detection_model: str, recognition_model: str, limit_side_len: int = 1600):
        self._ocr = PaddleOCR(
            text_detection_model_name=detection_model,
            text_recognition_model_name=recognition_model,
            device="cpu",
            enable_mkldnn=False,
            cpu_threads=2,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            text_det_limit_side_len=limit_side_len,
            text_det_limit_type="max",
            text_rec_score_thresh=0.0,
        )

    def __call__(self, image: np.ndarray, **kwargs: Any) -> OcrResult:
        if kwargs.get("use_det") is False and kwargs.get("use_rec") is True:
            return self.recognize_text_only(image)
        return self.recognize(image)

    def recognize(self, image: np.ndarray) -> OcrResult:
        raw_results = self._ocr.predict(image)
        merged = OcrResult(boxes=[], txts=[], scores=[])
        for raw_result in raw_results or []:
            result = self._normalize_result(raw_result)
            merged.boxes.extend(result.boxes)
            merged.txts.extend(result.txts)
            merged.scores.extend(result.scores)
        return merged

    def recognize_text_only(self, image: np.ndarray) -> OcrResult:
        return self.recognize(image)

    @staticmethod
    def _normalize_result(result: Any) -> OcrResult:
        if isinstance(result, dict):
            texts = result.get("rec_texts") or result.get("txts") or result.get("texts") or []
            scores = result.get("rec_scores") or result.get("scores") or []
            boxes = result.get("rec_polys") or result.get("dt_polys") or result.get("boxes") or []
            return OcrResult(
                boxes=list(boxes),
                txts=[str(text) for text in texts],
                scores=[float(score) for score in scores],
            )

        boxes = getattr(result, "rec_polys", None) or getattr(result, "dt_polys", None) or getattr(result, "boxes", [])
        texts = getattr(result, "rec_texts", None) or getattr(result, "txts", [])
        scores = getattr(result, "rec_scores", None) or getattr(result, "scores", [])
        return OcrResult(
            boxes=list(boxes),
            txts=[str(text) for text in texts],
            scores=[float(score) for score in scores],
        )


@lru_cache(maxsize=1)
def get_ocr_engine() -> PaddleOcrEngine:
    return PaddleOcrEngine(
        detection_model="PP-OCRv5_server_det",
        recognition_model="PP-OCRv5_server_rec",
        limit_side_len=1600,
    )


@lru_cache(maxsize=1)
def get_table_ocr_engine() -> PaddleOcrEngine:
    return PaddleOcrEngine(
        detection_model="PP-OCRv5_server_det",
        recognition_model="PP-OCRv5_server_rec",
        limit_side_len=1600,
    )
