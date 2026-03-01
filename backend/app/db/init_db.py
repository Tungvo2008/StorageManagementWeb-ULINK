from app.db.base import Base
from app.db.session import engine
from app.db.sqlite_migrations import run_sqlite_migrations
from app.db.seed import ensure_admin_user


def init_db() -> None:
    # Dev-friendly: auto-create tables. (Bạn có thể thay bằng Alembic khi cần.)
    from app.db import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    run_sqlite_migrations(engine)
    ensure_admin_user()
