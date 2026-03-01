from __future__ import annotations

import argparse
import csv
from datetime import datetime
from decimal import Decimal
from pathlib import Path
import sys

# Allow running as: `python scripts/export_issue_log_csv.py ...`
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Customer, Invoice, InvoiceLine, Product, SaleOrder
from app.db.session import engine


def main() -> int:
    parser = argparse.ArgumentParser(description="Export invoices as Issue Log CSV-like rows")
    parser.add_argument("--out", required=True, help="Output CSV path")
    args = parser.parse_args()

    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with Session(engine) as db:
        rows = build_rows(db)

    headers = [
        "No.",
        "GIN No.",
        "Invoice No.",
        "Date",
        "Client Code",
        "Client",
        "Tele",
        "Address",
        "City",
        "ZIP Code",
        "Item Code",
        "Item Description",
        "UOM",
        "Quantity",
        "Unit Price",
        "Total",
    ]

    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        w.writerows(rows)

    print(f"Wrote: {out_path}")
    print(f"Rows: {len(rows)}")
    return 0


def build_rows(db: Session) -> list[dict[str, str]]:
    invoices = db.scalars(select(Invoice)).all()
    invoices.sort(
        key=lambda inv: (
            inv.issue_log_no is None,
            inv.issue_log_no if inv.issue_log_no is not None else 10**9,
            inv.invoice_number,
            inv.id,
        )
    )

    product_ids: set[int] = set()
    invoice_ids: set[int] = set(inv.id for inv in invoices)
    line_stmt = select(InvoiceLine).where(InvoiceLine.invoice_id.in_(invoice_ids)).order_by(InvoiceLine.invoice_id.asc(), InvoiceLine.id.asc())
    lines = db.scalars(line_stmt).all()
    lines_by_invoice: dict[int, list[InvoiceLine]] = {}
    for line in lines:
        lines_by_invoice.setdefault(line.invoice_id, []).append(line)
        product_ids.add(line.product_id)

    products = db.scalars(select(Product).where(Product.id.in_(product_ids))).all()
    product_by_id = {p.id: p for p in products}

    # load sale orders + customers
    sale_ids = {inv.sale_order_id for inv in invoices}
    sales = db.scalars(select(SaleOrder).where(SaleOrder.id.in_(sale_ids))).all()
    sale_by_id = {s.id: s for s in sales}
    customer_ids = {s.customer_id for s in sales if s.customer_id is not None}
    customers = db.scalars(select(Customer).where(Customer.id.in_(customer_ids))).all()
    customer_by_id = {c.id: c for c in customers}

    out: list[dict[str, str]] = []
    for inv in invoices:
        inv_lines = lines_by_invoice.get(inv.id, [])
        if not inv_lines:
            continue
        sale = sale_by_id.get(inv.sale_order_id)
        cust = customer_by_id.get(sale.customer_id) if sale and sale.customer_id else None

        group_no_str = str(inv.issue_log_no) if inv.issue_log_no is not None else ""
        for line in inv_lines:
            p = product_by_id.get(line.product_id)
            dt = line.line_date or inv.issued_at
            date_str = format_mmddyy(dt)
            out.append(
                {
                    "No.": group_no_str,
                    "GIN No.": inv.gin_number or "",
                    "Invoice No.": inv.invoice_number,
                    "Date": date_str,
                    "Client Code": inv.client_code_snapshot or ((cust.code or "") if cust else ""),
                    "Client": inv.client_name_snapshot or ((cust.name or "") if cust else ""),
                    "Tele": inv.tele_snapshot or ((cust.phone or "") if cust else ""),
                    "Address": inv.address_snapshot or ((cust.address or "") if cust else ""),
                    "City": inv.city_snapshot or ((cust.city or "") if cust else ""),
                    "ZIP Code": inv.zip_code_snapshot or ((cust.zip_code or "") if cust else ""),
                    "Item Code": line.sku,
                    "Item Description": line.product_name,
                    "UOM": (line.uom or (p.uom if p else "")),
                    "Quantity": str(line.quantity),
                    "Unit Price": format_usd(Decimal(line.unit_price)),
                    "Total": format_usd(Decimal(line.line_total)),
                }
            )
    return out


def format_mmddyy(dt: datetime) -> str:
    d = dt.astimezone().date()
    yy = d.year % 100
    return f"{d.month}/{d.day}/{yy:02d}"


def format_usd(amount: Decimal) -> str:
    if amount < 0:
        return f"-${abs(amount):,.2f}"
    return f"${amount:,.2f}"


if __name__ == "__main__":
    raise SystemExit(main())
