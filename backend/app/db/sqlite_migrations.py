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


def _table_info(conn: Connection, table: str) -> list[dict[str, object]]:
    return [dict(r) for r in conn.execute(text(f"PRAGMA table_info({table})")).mappings().all()]


def _add_column_if_missing(conn: Connection, table: str, column: str, ddl: str) -> None:
    cols = _existing_columns(conn, table)
    if column in cols:
        return
    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))


def _rebuild_invoice_lines_for_free_lines(conn: Connection) -> None:
    info = _table_info(conn, "invoice_lines")
    if not info:
        return
    by_name = {str(row["name"]): row for row in info}
    product_id_row = by_name.get("product_id")
    line_type_row = by_name.get("line_type")
    if product_id_row and int(product_id_row.get("notnull") or 0) == 0 and line_type_row:
        return

    conn.execute(text("DROP TABLE IF EXISTS invoice_lines__new"))
    conn.execute(
        text(
            """
            CREATE TABLE invoice_lines__new (
                id INTEGER NOT NULL PRIMARY KEY,
                invoice_id INTEGER NOT NULL,
                product_id INTEGER,
                line_type VARCHAR(16) NOT NULL DEFAULT 'PRODUCT',
                sku VARCHAR(64) NOT NULL DEFAULT '',
                product_name VARCHAR(255) NOT NULL,
                uom VARCHAR(32) NOT NULL DEFAULT 'Pc',
                line_date DATETIME,
                quantity INTEGER NOT NULL,
                unit_price NUMERIC NOT NULL,
                discount_amount NUMERIC NOT NULL DEFAULT 0,
                line_total NUMERIC NOT NULL,
                FOREIGN KEY(invoice_id) REFERENCES invoices (id),
                FOREIGN KEY(product_id) REFERENCES products (id)
            )
            """
        )
    )
    cols = _existing_columns(conn, "invoice_lines")
    product_id_expr = "product_id" if "product_id" in cols else "NULL"
    line_type_expr = "'PRODUCT'" if "line_type" not in cols else "line_type"
    sku_expr = "COALESCE(sku, '')" if "sku" in cols else "''"
    uom_expr = "COALESCE(uom, 'Pc')" if "uom" in cols else "'Pc'"
    line_date_expr = "line_date" if "line_date" in cols else "NULL"
    discount_expr = "COALESCE(discount_amount, 0)" if "discount_amount" in cols else "0"
    conn.execute(
        text(
            f"""
            INSERT INTO invoice_lines__new (
                id, invoice_id, product_id, line_type, sku, product_name, uom, line_date,
                quantity, unit_price, discount_amount, line_total
            )
            SELECT
                id,
                invoice_id,
                {product_id_expr},
                {line_type_expr},
                {sku_expr},
                product_name,
                {uom_expr},
                {line_date_expr},
                quantity,
                unit_price,
                {discount_expr},
                line_total
            FROM invoice_lines
            """
        )
    )
    conn.execute(text("DROP TABLE invoice_lines"))
    conn.execute(text("ALTER TABLE invoice_lines__new RENAME TO invoice_lines"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_invoice_lines_invoice_id ON invoice_lines (invoice_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_invoice_lines_product_id ON invoice_lines (product_id)"))


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
        _add_column_if_missing(conn, "invoices", "merged_into_invoice_id", "merged_into_invoice_id INTEGER")
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
        _rebuild_invoice_lines_for_free_lines(conn)

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

    if "invoice_payments" not in tables:
        conn.execute(
            text(
                """
                CREATE TABLE invoice_payments (
                    id INTEGER NOT NULL PRIMARY KEY,
                    invoice_id INTEGER NOT NULL,
                    paid_at DATETIME NOT NULL,
                    amount NUMERIC NOT NULL DEFAULT 0,
                    method VARCHAR(64),
                    note TEXT,
                    created_by VARCHAR(64),
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(invoice_id) REFERENCES invoices (id)
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_invoice_payments_invoice_id ON invoice_payments (invoice_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_invoice_payments_paid_at ON invoice_payments (paid_at)"))
