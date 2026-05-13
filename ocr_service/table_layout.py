import json
import os
from functools import lru_cache
from pathlib import Path
from typing import TypedDict


class TableLayout(TypedDict):
    tableX: float
    tableY: float
    groupWidth: float
    numberColumnWidth: float
    rowHeight: float
    paddingX: float
    paddingY: float
    sourceWidthPaddingMultiplier: float
    sourceHeightPaddingMultiplier: float


DEFAULT_LAYOUT: TableLayout = {
    "tableX": 0.205,
    "tableY": 0.145,
    "groupWidth": 0.186,
    "numberColumnWidth": 0.039,
    "rowHeight": 0.067,
    "paddingX": 0.012,
    "paddingY": 0.014,
    "sourceWidthPaddingMultiplier": 2.5,
    "sourceHeightPaddingMultiplier": 1.6,
}


@lru_cache(maxsize=1)
def get_table_layout() -> TableLayout:
    config_path = Path(os.environ.get("TABLE_LAYOUT_CONFIG", Path(__file__).with_name("table_layout.json")))
    layout = DEFAULT_LAYOUT.copy()

    if config_path.exists():
        with config_path.open("r", encoding="utf-8") as config_file:
            raw_layout = json.load(config_file)
        for key, value in raw_layout.items():
            if key in layout:
                layout[key] = float(value)

    return layout
