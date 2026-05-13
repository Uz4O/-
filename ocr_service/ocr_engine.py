from functools import lru_cache

from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion, RapidOCR


@lru_cache(maxsize=1)
def get_ocr_engine() -> RapidOCR:
    params = {
        "Det.engine_type": EngineType.ONNXRUNTIME,
        "Det.lang_type": LangDet.CH,
        "Det.model_type": ModelType.MOBILE,
        "Det.ocr_version": OCRVersion.PPOCRV5,
        "Rec.engine_type": EngineType.ONNXRUNTIME,
        "Rec.lang_type": LangRec.CH,
        "Rec.model_type": ModelType.SERVER,
        "Rec.ocr_version": OCRVersion.PPOCRV5,
    }

    try:
        return RapidOCR(params=params)
    except Exception:
        fallback_params = {
            "Det.engine_type": EngineType.ONNXRUNTIME,
            "Rec.engine_type": EngineType.ONNXRUNTIME,
            "Rec.lang_type": LangRec.CH,
            "Rec.model_type": ModelType.MOBILE,
            "Rec.ocr_version": OCRVersion.PPOCRV5,
        }
        return RapidOCR(params=fallback_params)


@lru_cache(maxsize=1)
def get_table_ocr_engine() -> RapidOCR:
    params = {
        "Det.engine_type": EngineType.ONNXRUNTIME,
        "Det.lang_type": LangDet.CH,
        "Det.model_type": ModelType.MOBILE,
        "Det.ocr_version": OCRVersion.PPOCRV5,
        "Rec.engine_type": EngineType.ONNXRUNTIME,
        "Rec.lang_type": LangRec.CH,
        "Rec.model_type": ModelType.MOBILE,
        "Rec.ocr_version": OCRVersion.PPOCRV5,
    }
    return RapidOCR(params=params)
