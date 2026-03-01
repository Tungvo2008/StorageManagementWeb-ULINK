from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    _ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
    model_config = SettingsConfigDict(
        env_file=str(_ENV_PATH),
        env_ignore_empty=True,
        extra="ignore",
    )

    PROJECT_NAME: str = "Storage Management Web"
    API_V1_STR: str = "/api/v1"

    DATABASE_URL: str = "sqlite:///./storage.db"

    # pydantic-settings mặc định decode list[...] từ env bằng JSON.
    # Dùng NoDecode + validator để hỗ trợ format comma-separated (vd: "http://localhost:5173,http://localhost:3000")
    CORS_ORIGINS: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:5173"])

    COMPANY_NAME: str = "My Company"
    COMPANY_ADDRESS: str = ""
    COMPANY_PHONE: str = ""
    COMPANY_EMAIL: str = ""
    COMPANY_TAX_CODE: str = ""
    COMPANY_LOGO_PATH: str = ""
    # Optional (PDF invoice): Unicode font path to render Vietnamese correctly
    INVOICE_PDF_FONT_PATH: str = ""
    # Optional (PDF invoice): bold font path (if empty, fallback to regular font)
    INVOICE_PDF_FONT_BOLD_PATH: str = ""
    INVOICE_PAYMENT_LINES: str = ""

    DEFAULT_CURRENCY: str = "USD"
    DEFAULT_TAX_RATE: float = 0.0

    # Auth / JWT
    JWT_SECRET_KEY: str = "CHANGE_ME"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24h
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin"

    INVOICE_PREFIX: str = "UL"
    INVOICE_NUMBER_DIGITS: int = 4

    # Optional: đường dẫn tới file template .xlsm để export invoice theo mẫu Excel
    INVOICE_TEMPLATE_XLSM_PATH: str = ""

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _parse_cors_origins(cls, v):  # type: ignore[no-untyped-def]
        if v is None:
            return []
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v


settings = Settings()
