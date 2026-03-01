from __future__ import annotations

import argparse
from pathlib import Path
import sys

# Allow running as: `python scripts/reset_onhand.py`
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Product, StockMovement, StockMovementType
from app.db.session import engine


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reset all products.quantity_on_hand from stock flows (IN - OUT)."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print changes, do not save to DB.",
    )
    args = parser.parse_args()

    with Session(engine) as db:
        totals = {
            int(pid): int(total or 0)
            for pid, total in db.execute(
                select(
                    StockMovement.product_id,
                    func.coalesce(func.sum(StockMovement.quantity_delta), 0),
                )
                .where(
                    StockMovement.movement_type.in_(
                        [StockMovementType.IN, StockMovementType.OUT]
                    )
                )
                .group_by(StockMovement.product_id)
            ).all()
        }

        products = db.scalars(select(Product).order_by(Product.id.asc())).all()

        changed = 0
        unchanged = 0
        for p in products:
            new_qty = totals.get(p.id, 0)
            old_qty = int(p.quantity_on_hand or 0)
            if old_qty == new_qty:
                unchanged += 1
                continue
            changed += 1
            print(f"{p.id:>4} | {p.sku:<20} | onhand {old_qty} -> {new_qty}")
            p.quantity_on_hand = new_qty

        if args.dry_run:
            db.rollback()
            print(f"\nDry run only. Changed: {changed}, unchanged: {unchanged}, total: {len(products)}")
            return 0

        db.commit()
        print(f"\nSaved. Changed: {changed}, unchanged: {unchanged}, total: {len(products)}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
