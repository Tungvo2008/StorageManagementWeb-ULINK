from __future__ import annotations

import argparse
from pathlib import Path
import sys

# Allow running as: `python scripts/reset_inventory_data.py`
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import delete, text, update
from sqlalchemy.orm import Session

from app.db.models import (
    InventoryIssue,
    InventoryIssueLine,
    InventoryReceipt,
    InventoryReceiptLine,
    Invoice,
    InvoiceLine,
    Product,
    SaleOrder,
    SaleOrderLine,
    StockMovement,
)
from app.db.session import engine


def _count_rows(db: Session, table: str) -> int:
    return int(db.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar_one())


def _has_sqlite_sequence(db: Session) -> bool:
    row = db.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'")
    ).first()
    return row is not None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reset inventory transactional data and set all products onhand = 0."
    )
    parser.add_argument(
        "--reset-ids",
        action="store_true",
        help="Reset SQLite autoincrement ids for inventory/sales/invoice tables.",
    )
    args = parser.parse_args()

    with Session(engine) as db:
        before = {
            "products": _count_rows(db, "products"),
            "stock_movements": _count_rows(db, "stock_movements"),
            "inventory_receipts": _count_rows(db, "inventory_receipts"),
            "inventory_receipt_lines": _count_rows(db, "inventory_receipt_lines"),
            "inventory_issues": _count_rows(db, "inventory_issues"),
            "inventory_issue_lines": _count_rows(db, "inventory_issue_lines"),
            "sale_orders": _count_rows(db, "sale_orders"),
            "sale_order_lines": _count_rows(db, "sale_order_lines"),
            "invoices": _count_rows(db, "invoices"),
            "invoice_lines": _count_rows(db, "invoice_lines"),
        }

        db.execute(delete(StockMovement))
        db.execute(delete(InvoiceLine))
        db.execute(delete(Invoice))
        db.execute(delete(SaleOrderLine))
        db.execute(delete(SaleOrder))
        db.execute(delete(InventoryReceiptLine))
        db.execute(delete(InventoryReceipt))
        db.execute(delete(InventoryIssueLine))
        db.execute(delete(InventoryIssue))
        db.execute(update(Product).values(quantity_on_hand=0))

        if args.reset_ids and engine.dialect.name == "sqlite" and _has_sqlite_sequence(db):
            for table_name in [
                "stock_movements",
                "invoice_lines",
                "invoices",
                "sale_order_lines",
                "sale_orders",
                "inventory_receipt_lines",
                "inventory_receipts",
                "inventory_issue_lines",
                "inventory_issues",
            ]:
                db.execute(
                    text("DELETE FROM sqlite_sequence WHERE name = :name"),
                    {"name": table_name},
                )

        db.commit()

        print("Reset completed.")
        for k, v in before.items():
            print(f"- {k}: {v}")
        print("- products onhand set to 0")
        if args.reset_ids:
            print("- sqlite autoincrement ids reset")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
