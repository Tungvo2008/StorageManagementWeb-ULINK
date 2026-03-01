from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine


def run_sqlite_migrations(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        _ensure_columns(conn)


def _existing_columns(conn: Connection, table: str) -> set[str]:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).mappings().all()
    return {str(r["name"]) for r in rows}


def _add_column_if_missing(conn: Connection, table: str, column: str, ddl: str) -> None:
    cols = _existing_columns(conn, table)
    if column in cols:
        return
    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))


def _ensure_columns(conn: Connection) -> None:
    # Only additive migrations here (safe for existing data).
    # NOTE: SQLite can't drop/alter columns easily without table rebuild.
    tables = {
        r["name"]
        for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).mappings().all()
    }

    if "products" in tables:
        _add_column_if_missing(conn, "products", "uom", "uom TEXT NOT NULL DEFAULT 'Pc'")
        _add_column_if_missing(conn, "products", "uom_multiplier", "uom_multiplier INTEGER NOT NULL DEFAULT 1")
        _add_column_if_missing(conn, "products", "category_id", "category_id INTEGER")
        _add_column_if_missing(conn, "products", "image_url", "image_url TEXT")
        _add_column_if_missing(conn, "products", "base_uom", "base_uom TEXT NOT NULL DEFAULT 'Pc'")
        _add_column_if_missing(conn, "products", "cost_price", "cost_price NUMERIC NOT NULL DEFAULT 0")

    if "customers" in tables:
        _add_column_if_missing(conn, "customers", "code", "code TEXT")
        _add_column_if_missing(conn, "customers", "city", "city TEXT")
        _add_column_if_missing(conn, "customers", "zip_code", "zip_code TEXT")

    if "invoices" in tables:
        _add_column_if_missing(conn, "invoices", "gin_number", "gin_number TEXT")
        _add_column_if_missing(conn, "invoices", "issue_log_no", "issue_log_no INTEGER")
        _add_column_if_missing(conn, "invoices", "client_code_snapshot", "client_code_snapshot TEXT")
        _add_column_if_missing(conn, "invoices", "client_name_snapshot", "client_name_snapshot TEXT")
        _add_column_if_missing(conn, "invoices", "tele_snapshot", "tele_snapshot TEXT")
        _add_column_if_missing(conn, "invoices", "address_snapshot", "address_snapshot TEXT")
        _add_column_if_missing(conn, "invoices", "city_snapshot", "city_snapshot TEXT")
        _add_column_if_missing(conn, "invoices", "zip_code_snapshot", "zip_code_snapshot TEXT")
        _add_column_if_missing(conn, "invoices", "order_discount_amount", "order_discount_amount NUMERIC NOT NULL DEFAULT 0")
        _add_column_if_missing(conn, "invoices", "discount_amount", "discount_amount NUMERIC NOT NULL DEFAULT 0")
        _add_column_if_missing(conn, "invoices", "shipping_amount", "shipping_amount NUMERIC NOT NULL DEFAULT 0")

    if "invoice_lines" in tables:
        _add_column_if_missing(conn, "invoice_lines", "uom", "uom TEXT NOT NULL DEFAULT 'Pc'")
        _add_column_if_missing(conn, "invoice_lines", "line_date", "line_date DATETIME")
        _add_column_if_missing(conn, "invoice_lines", "discount_amount", "discount_amount NUMERIC NOT NULL DEFAULT 0")

    if "stock_movements" in tables:
        _add_column_if_missing(conn, "stock_movements", "receipt_id", "receipt_id INTEGER")
        _add_column_if_missing(conn, "stock_movements", "receipt_line_id", "receipt_line_id INTEGER")
        _add_column_if_missing(conn, "stock_movements", "issue_id", "issue_id INTEGER")
        _add_column_if_missing(conn, "stock_movements", "issue_line_id", "issue_line_id INTEGER")
        _add_column_if_missing(conn, "stock_movements", "sale_order_id", "sale_order_id INTEGER")

    if "sale_orders" in tables:
        _add_column_if_missing(conn, "sale_orders", "order_discount_amount", "order_discount_amount NUMERIC NOT NULL DEFAULT 0")
        _add_column_if_missing(conn, "sale_orders", "discount_amount", "discount_amount NUMERIC NOT NULL DEFAULT 0")
        _add_column_if_missing(conn, "sale_orders", "shipping_amount", "shipping_amount NUMERIC NOT NULL DEFAULT 0")

    if "sale_order_lines" in tables:
        _add_column_if_missing(conn, "sale_order_lines", "discount_amount", "discount_amount NUMERIC NOT NULL DEFAULT 0")
