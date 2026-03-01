from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
import sys

# Allow running as: `python scripts/import_legacy_amazon_issue_csv.py`
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.inventory import _create_issue
from app.db.models import Product
from app.db.session import engine
from app.schemas.inventory import InventoryIssueCreate


IMPORT_NOTE_PREFIX = "Imported from legacy Amazon issue CSV"


def _header_value(row: dict[str, str], names: list[str]) -> str:
    for name in names:
        value = row.get(name)
        if value is not None:
            return str(value).strip()
    return ""


def _parse_date(value: str) -> date:
    raw = value.strip()
    for fmt in ("%m/%d/%y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise RuntimeError(f"Invalid date value: {value!r}")


def _normalize_purpose(value: str) -> str:
    s = value.strip().upper().replace("-", "_").replace(" ", "_")
    if s in {"FBA", "AMAZON_FBA"}:
        return "AMAZON_FBA"
    if s in {"FBM", "AMAZON_FBM"}:
        return "AMAZON_FBM"
    raise RuntimeError(f"Unknown fulfilment method: {value!r} (expected FBA/FBM)")


def _parse_quantity(value: str) -> int:
    text = value.strip().replace(",", "")
    if not text:
        raise RuntimeError("Quantity is empty")
    try:
        qty = int(float(text))
    except Exception as e:
        raise RuntimeError(f"Invalid quantity: {value!r}") from e
    if qty <= 0:
        raise RuntimeError(f"Quantity must be > 0, got {qty}")
    return qty


def _build_product_map(db: Session) -> dict[str, Product]:
    products = db.scalars(select(Product)).all()
    return {p.sku.strip().upper(): p for p in products if p.sku and p.sku.strip()}


def _upsert_product(db: Session, product_by_sku: dict[str, Product], sku: str, product_name: str) -> Product:
    key = sku.strip().upper()
    existing = product_by_sku.get(key)
    if existing is not None:
        return existing

    product = Product(
        sku=sku.strip(),
        name=product_name.strip() or sku.strip(),
        base_uom="Pc",
        uom="Pc",
        uom_multiplier=1,
        unit_price=0,
        cost_price=0,
        currency="USD",
        quantity_on_hand=0,
        is_active=True,
    )
    db.add(product)
    db.flush()
    product_by_sku[key] = product
    return product


def _read_rows(csv_path: Path) -> list[dict]:
    if not csv_path.is_file():
        raise RuntimeError(f"CSV not found: {csv_path}")

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return []

        rows: list[dict] = []
        for row_i, row in enumerate(reader, start=2):
            date_raw = _header_value(row, ["Date", "date"])
            method_raw = _header_value(row, ["Fulfilment Method", "Fulfillment Method", "Method", "method"])
            sku_raw = _header_value(row, ["Product Code", "SKU", "Item Code", "sku"])
            name_raw = _header_value(row, ["Product Name", "Item Description", "name"])
            qty_raw = _header_value(row, ["Quantity", "Qty", "quantity"])
            if not date_raw and not method_raw and not sku_raw and not qty_raw:
                continue
            if not date_raw or not method_raw or not sku_raw or not qty_raw:
                raise RuntimeError(f"Row {row_i}: missing required fields (Date, Fulfilment Method, Product Code, Quantity)")

            rows.append(
                {
                    "row_i": row_i,
                    "date": _parse_date(date_raw),
                    "purpose": _normalize_purpose(method_raw),
                    "sku": sku_raw.strip(),
                    "product_name": name_raw.strip(),
                    "quantity": _parse_quantity(qty_raw),
                }
            )
    return rows


def _import_grouped_issues(
    *,
    db: Session,
    source_name: str,
    grouped: dict[tuple[date, str], list[dict]],
    product_by_sku: dict[str, Product],
    actor_username: str,
) -> tuple[int, int]:
    created_forms = 0
    created_lines = 0
    for (issued_date, purpose), rows in sorted(grouped.items(), key=lambda item: (item[0][0], item[0][1])):
        qty_by_sku: dict[str, int] = defaultdict(int)
        name_by_sku: dict[str, str] = {}
        for row in rows:
            sku = row["sku"].strip()
            qty_by_sku[sku] += int(row["quantity"])
            if row["product_name"] and sku not in name_by_sku:
                name_by_sku[sku] = row["product_name"]

        lines: list[dict] = []
        for sku, qty in sorted(qty_by_sku.items()):
            product = _upsert_product(db, product_by_sku, sku, name_by_sku.get(sku, sku))
            lines.append({"product_id": product.id, "quantity": qty, "unit": "SALE"})

        issued_to = "Amazon FBA" if purpose == "AMAZON_FBA" else "Amazon FBM"
        body = InventoryIssueCreate(
            issue_number=None,
            issued_at=datetime.combine(issued_date, datetime.min.time(), tzinfo=timezone.utc),
            issued_by=actor_username,
            issued_to=issued_to,
            purpose=purpose,
            note=f"{IMPORT_NOTE_PREFIX}: {source_name} ({purpose})",
            lines=lines,
        )
        try:
            _create_issue(body=body, db=db, actor_username=actor_username)
        except HTTPException as e:
            raise RuntimeError(
                f"Import failed for {issued_date.isoformat()} {purpose}: {e.detail}"
            ) from e
        created_forms += 1
        created_lines += len(lines)
    return created_forms, created_lines


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import legacy Amazon issue CSV into InventoryIssue forms grouped by date + FBA/FBM."
    )
    parser.add_argument("--csv", required=True, help="Path to legacy CSV (Date, Fulfilment Method, Product Code, Quantity)")
    parser.add_argument(
        "--issued-by",
        default="system-import",
        help="Username shown in issued_by for imported forms (default: system-import)",
    )
    args = parser.parse_args()

    csv_path = Path(args.csv).expanduser()
    rows = _read_rows(csv_path)
    if not rows:
        print("No rows to import.")
        return 0

    grouped: dict[tuple[date, str], list[dict]] = defaultdict(list)
    for row in rows:
        grouped[(row["date"], row["purpose"])].append(row)

    with Session(engine) as db:
        product_by_sku = _build_product_map(db)
        created_forms, created_lines = _import_grouped_issues(
            db=db,
            source_name=csv_path.name,
            grouped=grouped,
            product_by_sku=product_by_sku,
            actor_username=args.issued_by.strip() or "system-import",
        )

    print("Legacy Amazon issue CSV import done.")
    print(f"- file: {csv_path}")
    print(f"- input rows: {len(rows)}")
    print(f"- created issue forms: {created_forms}")
    print(f"- created issue lines: {created_lines}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
