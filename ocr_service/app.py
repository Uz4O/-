from fastapi import FastAPI, HTTPException

from .chat_recognizer import recognize_chat
from .image_utils import decode_image_base64
from .ocr_engine import get_ocr_engine
from .schemas import HealthResponse, ImageRequest
from .table_recognizer import recognize_table


app = FastAPI(title="Mark Six OCR Service")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    get_ocr_engine()
    return HealthResponse(ok=True, provider="rapidocr", model="ppocr")


@app.post("/recognize/table")
def recognize_table_endpoint(payload: ImageRequest):
    try:
        image = decode_image_base64(payload.imageBase64)
        return recognize_table(image)
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.post("/recognize/chat")
def recognize_chat_endpoint(payload: ImageRequest):
    try:
        image = decode_image_base64(payload.imageBase64)
        return recognize_chat(image)
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

