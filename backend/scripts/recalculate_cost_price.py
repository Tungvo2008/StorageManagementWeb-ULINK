from __future__ import annotations

import argparse
from collections import defaultdict
from decimal import Decimal
from pathlib import Path
import sys

# Allow running as: `python scripts/recalculate_cost_price.py`
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import InventoryReceiptLine, Product, StockMovement, StockMovementType
from app.db.session import engine
from app.services.money import quantize_money


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Recalculate products.cost_price from stock movement history (moving average on IN receipts)."
    )
    parser.add_argument("--dry-run", action="store_true", help="Only preview changes, do not save.")
    args = parser.parse_args()

    with Session(engine) as db:
        products = db.scalars(select(Product).order_by(Product.id.asc())).all()
        product_by_id = {p.id: p for p in products}

        receipt_lines = db.scalars(select(InventoryReceiptLine)).all()
        receipt_line_by_id = {line.id: line for line in receipt_lines}

        movements = db.scalars(
            select(StockMovement).order_by(StockMovement.created_at.asc(), StockMovement.id.asc())
        ).all()

        running_qty: dict[int, int] = defaultdict(int)
        running_cost: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))

        for movement in movements:
            product_id = int(movement.product_id)
            delta = int(movement.quantity_delta or 0)
            movement_type = movement.movement_type

            if movement_type == StockMovementType.IN and movement.receipt_line_id is not None and delta > 0:
                line = receipt_line_by_id.get(int(movement.receipt_line_id))
                if line is not None:
                    base_qty = delta
                    line_total = Decimal(line.line_total or 0)
                    line_base_cost = quantize_money(line_total / Decimal(base_qty))

                    old_qty = int(running_qty.get(product_id, 0))
                    old_cost = Decimal(running_cost.get(product_id, Decimal("0")))
                    if old_qty <= 0:
                        running_cost[product_id] = line_base_cost
                    else:
                        total_qty = old_qty + base_qty
                        weighted_total = (old_cost * Decimal(old_qty)) + line_total
                        running_cost[product_id] = quantize_money(weighted_total / Decimal(total_qty))

            running_qty[product_id] = int(running_qty.get(product_id, 0)) + delta

        changed = 0
        for product in products:
            new_cost = quantize_money(running_cost.get(product.id, Decimal("0")))
            old_cost = quantize_money(Decimal(product.cost_price or 0))
            if new_cost == old_cost:
                continue
            changed += 1
            print(f"{product.id:>4} | {product.sku:<20} | cost {old_cost} -> {new_cost}")
            product.cost_price = new_cost

        if args.dry_run:
            db.rollback()
            print(f"\nDry run only. Changed: {changed}, total products: {len(products)}")
            return 0

        db.commit()
        print(f"\nSaved. Changed: {changed}, total products: {len(products)}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
