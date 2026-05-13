from pydantic import BaseModel


class ImageRequest(BaseModel):
    imageBase64: str
    mimeType: str | None = None


class HealthResponse(BaseModel):
    ok: bool
    provider: str
    model: str

