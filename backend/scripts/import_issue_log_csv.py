from __future__ import annotations

import argparse
from pathlib import Path
import sys

# Allow running as: `python scripts/import_issue_log_csv.py`
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Customer, Invoice, Product, SaleOrder, StockMovement
from app.db.session import engine
from scripts.import_storage_management import import_issue_log, read_issue_log_csv


def _build_product_map(db: Session) -> dict[str, Product]:
    products = db.scalars(select(Product)).all()
    return {p.sku: p for p in products if p.sku}


def _build_customer_code_map(db: Session) -> dict[int, int]:
    mapping: dict[int, int] = {}
    customers = db.scalars(select(Customer)).all()
    for c in customers:
        if not c.code:
            continue
        digits = "".join(ch for ch in c.code if ch.isdigit())
        if not digits:
            continue
        try:
            mapping[int(digits)] = c.id
        except Exception:
            continue
    return mapping


def main() -> int:
    parser = argparse.ArgumentParser(description="Import invoices/sales/stock OUT from Issue Log CSV.")
    parser.add_argument("--csv", required=True, help="Path to issue-log CSV")
    parser.add_argument(
        "--skip-existing-invoices",
        action="store_true",
        help="Skip invoice_number that already exists in DB",
    )
    args = parser.parse_args()

    csv_path = Path(args.csv).expanduser()
    rows = read_issue_log_csv(csv_path)

    with Session(engine) as db:
        product_by_sku = _build_product_map(db)
        customer_code_to_customer_id = _build_customer_code_map(db)

        before_invoices = db.query(Invoice).count()
        before_sales = db.query(SaleOrder).count()
        before_moves = db.query(StockMovement).count()

        import_issue_log(
            db,
            rows,
            product_by_sku,
            customer_code_to_customer_id,
            skip_existing_invoices=args.skip_existing_invoices,
        )
        db.commit()

        after_invoices = db.query(Invoice).count()
        after_sales = db.query(SaleOrder).count()
        after_moves = db.query(StockMovement).count()

    print("Issue log import done.")
    print(f"- invoices: {before_invoices} -> {after_invoices} (+{after_invoices - before_invoices})")
    print(f"- sales: {before_sales} -> {after_sales} (+{after_sales - before_sales})")
    print(f"- stock movements: {before_moves} -> {after_moves} (+{after_moves - before_moves})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
