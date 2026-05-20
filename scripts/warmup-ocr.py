import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ocr_service.ocr_engine import get_ocr_engine, get_table_ocr_engine


def main() -> None:
    get_ocr_engine()
    get_table_ocr_engine()
    print("OCR engine warmed up")


if __name__ == "__main__":
    main()
