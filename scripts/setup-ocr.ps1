$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  throw "未找到 Python。请安装 Python 3.10/3.11，并关闭 Windows Store python alias。"
}

$version = & python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($version -notin @("3.10", "3.11")) {
  throw "当前 Python 版本是 $version，请使用 Python 3.10 或 3.11。"
}

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r ocr_service\requirements.txt
.\.venv\Scripts\python.exe scripts\warmup-ocr.py

