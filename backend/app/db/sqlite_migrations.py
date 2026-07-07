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
    order_index_row = by_name.get("order_index")
    if product_id_row and int(product_id_row.get("notnull") or 0) == 0 and line_type_row and order_index_row:
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
                order_index INTEGER NOT NULL DEFAULT 0,
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
    order_index_expr = "COALESCE(order_index, id)" if "order_index" in cols else "id"
    discount_expr = "COALESCE(discount_amount, 0)" if "discount_amount" in cols else "0"
    conn.execute(
        text(
            f"""
            INSERT INTO invoice_lines__new (
                id, invoice_id, product_id, line_type, sku, product_name, uom, line_date, order_index,
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
                {order_index_expr},
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


def _rebuild_invoices_for_manual_and_merge(conn: Connection) -> None:
    info = _table_info(conn, "invoices")
    if not info:
        return

    by_name = {str(row["name"]): row for row in info}
    sale_order_row = by_name.get("sale_order_id")
    needs_rebuild = False

    if sale_order_row and int(sale_order_row.get("notnull") or 0) == 1:
        needs_rebuild = True

    required_columns = {
        "merged_into_invoice_id",
        "order_discount_amount",
        "discount_amount",
        "shipping_amount",
    }
    if not required_columns.issubset(by_name):
        needs_rebuild = True

    if not needs_rebuild:
        return

    conn.execute(text("DROP TABLE IF EXISTS invoices__new"))
    conn.execute(
        text(
            """
            CREATE TABLE invoices__new (
                id INTEGER NOT NULL PRIMARY KEY,
                sale_order_id INTEGER,
                merged_into_invoice_id INTEGER,
                invoice_number VARCHAR(64) NOT NULL,
                gin_number VARCHAR(64),
                issue_log_no INTEGER,
                client_code_snapshot VARCHAR(32),
                client_name_snapshot VARCHAR(255),
                tele_snapshot VARCHAR(64),
                address_snapshot TEXT,
                city_snapshot VARCHAR(255),
                zip_code_snapshot VARCHAR(32),
                issued_at DATETIME NOT NULL,
                due_at DATETIME,
                status VARCHAR(16) NOT NULL,
                currency VARCHAR(8) NOT NULL,
                tax_rate NUMERIC(6, 4) NOT NULL,
                subtotal_amount NUMERIC(12, 2) NOT NULL,
                order_discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
                discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
                shipping_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
                tax_amount NUMERIC(12, 2) NOT NULL,
                total_amount NUMERIC(12, 2) NOT NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                CONSTRAINT uq_invoice_invoice_number UNIQUE (invoice_number),
                CONSTRAINT uq_invoice_sale_order_id UNIQUE (sale_order_id),
                FOREIGN KEY(sale_order_id) REFERENCES sale_orders (id),
                FOREIGN KEY(merged_into_invoice_id) REFERENCES invoices (id)
            )
            """
        )
    )

    cols = _existing_columns(conn, "invoices")
    merged_expr = "merged_into_invoice_id" if "merged_into_invoice_id" in cols else "NULL"
    gin_expr = "gin_number" if "gin_number" in cols else "NULL"
    issue_log_expr = "issue_log_no" if "issue_log_no" in cols else "NULL"
    client_code_expr = "client_code_snapshot" if "client_code_snapshot" in cols else "NULL"
    client_name_expr = "client_name_snapshot" if "client_name_snapshot" in cols else "NULL"
    tele_expr = "tele_snapshot" if "tele_snapshot" in cols else "NULL"
    address_expr = "address_snapshot" if "address_snapshot" in cols else "NULL"
    city_expr = "city_snapshot" if "city_snapshot" in cols else "NULL"
    zip_expr = "zip_code_snapshot" if "zip_code_snapshot" in cols else "NULL"
    order_discount_expr = "COALESCE(order_discount_amount, 0)" if "order_discount_amount" in cols else "0"
    discount_expr = "COALESCE(discount_amount, 0)" if "discount_amount" in cols else "0"
    shipping_expr = "COALESCE(shipping_amount, 0)" if "shipping_amount" in cols else "0"

    conn.execute(
        text(
            f"""
            INSERT INTO invoices__new (
                id, sale_order_id, merged_into_invoice_id, invoice_number, gin_number, issue_log_no,
                client_code_snapshot, client_name_snapshot, tele_snapshot, address_snapshot, city_snapshot, zip_code_snapshot,
                issued_at, due_at, status, currency, tax_rate, subtotal_amount, order_discount_amount,
                discount_amount, shipping_amount, tax_amount, total_amount, created_at, updated_at
            )
            SELECT
                id,
                sale_order_id,
                {merged_expr},
                invoice_number,
                {gin_expr},
                {issue_log_expr},
                {client_code_expr},
                {client_name_expr},
                {tele_expr},
                {address_expr},
                {city_expr},
                {zip_expr},
                issued_at,
                due_at,
                status,
                currency,
                tax_rate,
                subtotal_amount,
                {order_discount_expr},
                {discount_expr},
                {shipping_expr},
                tax_amount,
                total_amount,
                created_at,
                updated_at
            FROM invoices
            """
        )
    )
    conn.execute(text("DROP TABLE invoices"))
    conn.execute(text("ALTER TABLE invoices__new RENAME TO invoices"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_invoices_issue_log_no ON invoices (issue_log_no)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_invoices_sale_order_id ON invoices (sale_order_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_invoices_merged_into_invoice_id ON invoices (merged_into_invoice_id)"))


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
        _rebuild_invoices_for_manual_and_merge(conn)
        _add_column_if_missing(conn, "invoices", "merged_into_invoice_id", "merged_into_invoice_id INTEGER")
        _add_column_if_missing(conn, "invoices", "gin_number", "gin_number TEXT")
        _add_column_if_missing(conn, "invoices", "issue_log_no", "issue_log_no INTEGER")
        _add_column_if_missing(conn, "invoices", "client_code_snapshot", "client_code_snapshot TEXT")
        _add_column_if_missing(conn, "invoices", "client_name_snapshot", "client_name_snapshot TEXT")
        _add_column_if_missing(conn, "invoices", "tele_snapshot", "tele_snapshot TEXT")
        _add_column_if_missing(conn, "invoices", "address_snapshot", "address_snapshot TEXT")
        _add_column_if_missing(conn, "invoices", "city_snapshot", "city_snapshot TEXT")
        _add_column_if_missing(conn, "invoices", "zip_code_snapshot", "zip_code_snapshot TEXT")
        _add_column_if_missing(conn, "invoices", "note", "note TEXT")
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
