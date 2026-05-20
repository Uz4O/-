# PaddleOCR Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace RapidOCR with high-accuracy PaddleOCR for table and chat recognition, then verify against the three provided WeChat screenshots.

**Architecture:** Add a focused PaddleOCR adapter in `ocr_service/ocr_engine.py` that normalizes PaddleOCR output into the existing recognizer shape. Keep current chat/table recognizer boundaries, but route all OCR calls through PaddleOCR server models and score multiple image variants for accuracy.

**Tech Stack:** Python FastAPI, PaddleOCR, OpenCV, NumPy, existing Node/React API proxy.

---

### Task 1: Regression Coverage for Provided Chat Screenshots

**Files:**
- Modify: `ocr_service/test_chat_recognizer.py`
- Read assets from the three absolute image paths supplied by the user.

- [ ] Add tests that call `recognize_chat` on each available sample image and assert the critical visible text is present.
- [ ] Run the targeted Python test before implementation and confirm current RapidOCR fails at least the Image 1 assertions for `01 14 28/200` and `08 23 31 39/100`.

### Task 2: PaddleOCR Engine Adapter

**Files:**
- Modify: `ocr_service/requirements.txt`
- Modify: `ocr_service/ocr_engine.py`
- Modify: `scripts/warmup-ocr.py`

- [ ] Replace RapidOCR dependencies with PaddleOCR dependencies.
- [ ] Implement cached PaddleOCR constructors for chat and table recognition using high-accuracy server model settings.
- [ ] Normalize PaddleOCR result formats into a small object with `boxes`, `txts`, and `scores`, preserving compatibility with existing recognizers.
- [ ] Warm up both chat and table OCR engines.

### Task 3: Recognizer Integration

**Files:**
- Modify: `ocr_service/chat_recognizer.py`
- Modify: `ocr_service/table_recognizer.py`

- [ ] Update calls that previously used RapidOCR-specific `use_det/use_rec` arguments so they go through adapter methods.
- [ ] Keep existing cleaning, table cell crop, low-confidence, and variant scoring behavior.
- [ ] Add an additional high-contrast chat image variant only if it improves sample accuracy without losing lines.

### Task 4: Verification

**Files:**
- No production file writes unless test evidence requires fixes.

- [ ] Run `python -m unittest ocr_service.test_chat_recognizer`.
- [ ] Run direct OCR verification against all three screenshots.
- [ ] Run `npm run test`.
- [ ] Run `npm run build`.

### Task 5: Deployment Sync

**Files:**
- Server `/opt/mark-six` via SSH/rsync.

- [ ] Sync source changes excluding `.env`, `.venv`, `node_modules`, `dist`, `.git`, logs, models.
- [ ] On server, run dependency install, tests, build, and `pm2 restart mark-six-api mark-six-ocr`.
- [ ] Check `pm2 status` and health endpoint.
