#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON_BIN="${PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  if command -v python3.11 >/dev/null 2>&1; then
    PYTHON_BIN=python3.11
  elif command -v python3.10 >/dev/null 2>&1; then
    PYTHON_BIN=python3.10
  elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN=python3
  else
    echo "未找到 Python 3.10/3.11，请先安装 Python。" >&2
    exit 1
  fi
fi

"$PYTHON_BIN" -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r ocr_service/requirements.txt
.venv/bin/python scripts/warmup-ocr.py

