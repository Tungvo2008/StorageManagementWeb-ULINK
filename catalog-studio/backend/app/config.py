from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    DATABASE_URL: str = f"sqlite:///{BASE_DIR / 'catalog.db'}"
    UPLOAD_DIR: str = "assets/uploads"
    CORS_ORIGINS: str = "http://localhost:5174,http://127.0.0.1:5174"
    COMPANY_NAME: str = "ULINK LLC"
    COMPANY_WEBSITE: str = "www.ulinkllc.com"
    COMPANY_EMAIL: str = "info@ulinkllc.com"
    COMPANY_PHONE: str = "+1 (314) 452-7023"
    BRAND_COLOR: str = "#15509B"

    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        return [value.strip() for value in self.CORS_ORIGINS.split(",") if value.strip()]


settings = Settings()
