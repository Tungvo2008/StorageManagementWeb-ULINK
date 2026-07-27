from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.db.init_db import init_db


def create_app() -> FastAPI:
    app = FastAPI(title=settings.PROJECT_NAME)
    product_image_dir = Path(__file__).resolve().parents[1] / "assets" / "product-images"

    cors_origins = settings.CORS_ORIGINS
    if cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.mount(
        f"{settings.API_V1_STR}/public/product-images",
        StaticFiles(directory=product_image_dir, check_dir=False),
        name="product-images",
    )
    app.include_router(api_router, prefix=settings.API_V1_STR)

    @app.on_event("startup")
    def _startup() -> None:
        init_db()

    return app


app = create_app()
