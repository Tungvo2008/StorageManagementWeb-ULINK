from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
import sys

# Allow running as: `python scripts/import_storage_management.py ...`
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.base import Base
from app.db.models import (
    Customer,
    Invoice,
    InvoiceLine,
    InvoiceStatus,
    Product,
    SaleOrder,
    SaleOrderLine,
    SaleStatus,
    StockMovement,
    StockMovementType,
)
from app.db.session import engine
from app.services.openxml_reader import OpenXmlWorkbook


def main() -> int:
    parser = argparse.ArgumentParser(description="Import data from Storage Management.xlsm into SQLite")
    parser.add_argument("--file", required=True, help="Path to 'Storage Management.xlsm'")
    parser.add_argument(
        "--issue-log-csv",
        default="",
        help="Optional path to Issue Log CSV (exported from Excel). If set, CSV is used as the source of invoices.",
    )
    parser.add_argument("--reset-db", action="store_true", help="Drop & recreate tables before importing (DESTRUCTIVE)")
    parser.add_argument(
        "--skip-existing-invoices",
        action="store_true",
        help="Skip invoices already present in DB (by invoice_number)",
    )
    args = parser.parse_args()

    xlsm_path = Path(args.file).expanduser()
    if not xlsm_path.is_file():
        raise SystemExit(f"File not found: {xlsm_path}")

    if args.reset_db:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)

    with Session(engine) as db, OpenXmlWorkbook(xlsm_path) as wb:
        print("Sheets:", ", ".join(wb.list_sheet_names()))

        product_by_sku = import_products(db, wb)
        client_code_to_customer_id = import_customers(db, wb)

        storage_rows = wb.read_table(
            sheet_name="Storage Count",
            header_row=2,
            headers=["Item Code", "Receipt", "Store"],
            start_row=3,
            stop_when_blank_in="Item Code",
        )

        if args.issue_log_csv:
            issue_rows = read_issue_log_csv(Path(args.issue_log_csv).expanduser())
        else:
            issue_rows = wb.read_table(
                sheet_name="Issue Log",
                header_row=2,
                headers=[
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
                ],
                start_row=3,
                stop_when_blank_in="Item Code",
            )

        amazon_rows = wb.read_table(
            sheet_name="Amazon Issue",
            header_row=1,
            headers=["Date", "Fulfilment Method", "Product Code", "Product Name", "Quantity"],
            start_row=2,
            stop_when_blank_in="Product Code",
        )

        base_receipt_date = _find_earliest_log_date(issue_rows, amazon_rows)
        if base_receipt_date is None:
            base_receipt_date = datetime.now(timezone.utc).date()
        base_receipt_dt = datetime.combine(base_receipt_date - timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        apply_receipts_and_store(db, storage_rows, product_by_sku, base_receipt_dt)
        import_issue_log(
            db,
            issue_rows,
            product_by_sku,
            client_code_to_customer_id,
            skip_existing_invoices=args.skip_existing_invoices,
        )
        import_amazon_issue(db, amazon_rows, product_by_sku)

        # Reconcile quantity_on_hand vs Storage Count (Store)
        reconcile_stock(db, storage_rows, product_by_sku)

        db.commit()
        print("Import done.")

    return 0


def import_products(db: Session, wb: OpenXmlWorkbook) -> dict[str, Product]:
    rows = wb.read_table(
        sheet_name="Product Info",
        header_row=2,
        headers=["Item Code", "Item Description", "Unit of Measurement", "Price"],
        start_row=3,
        stop_when_blank_in="Item Code",
    )

    product_by_sku: dict[str, Product] = {}
    for r in rows:
        sku = (r.get("Item Code") or "").strip() if isinstance(r.get("Item Code"), str) else ""
        if not sku:
            continue
        name = (r.get("Item Description") or "").strip() if isinstance(r.get("Item Description"), str) else sku
        uom = (r.get("Unit of Measurement") or "Pc").strip() if isinstance(r.get("Unit of Measurement"), str) else "Pc"
        price = r.get("Price")
        unit_price = Decimal(str(price)) if price not in (None, "") else Decimal("0")

        uom_multiplier = 12 if uom.lower() == "dozen" else 1

        existing = db.scalar(select(Product).where(Product.sku == sku))
        if existing is None:
            existing = Product(
                sku=sku,
                name=name,
                uom=uom or "Pc",
                uom_multiplier=uom_multiplier,
                unit_price=unit_price,
                currency=settings.DEFAULT_CURRENCY,
                quantity_on_hand=0,
                is_active=True,
            )
            db.add(existing)
        else:
            existing.name = name
            existing.uom = uom or existing.uom
            existing.uom_multiplier = uom_multiplier
            existing.unit_price = unit_price
            existing.currency = settings.DEFAULT_CURRENCY

        product_by_sku[sku] = existing

    db.flush()
    print(f"Imported products: {len(product_by_sku)}")
    return product_by_sku


def import_customers(db: Session, wb: OpenXmlWorkbook) -> dict[int, int]:
    rows = wb.read_table(
        sheet_name="Client Info",
        header_row=2,
        headers=["No.", "Client Name", "Tele", "Address", "City", "ZIP Code"],
        start_row=3,
        stop_when_blank_in="Client Name",
    )

    mapping: dict[int, int] = {}
    for r in rows:
        code_raw = r.get("No.")
        try:
            code = int(code_raw) if code_raw is not None else None
        except Exception:
            code = None
        code_str = f"C{code:04d}" if code is not None else None

        name = (r.get("Client Name") or "").strip() if isinstance(r.get("Client Name"), str) else ""
        if not name:
            continue
        phone = str(r.get("Tele")) if r.get("Tele") not in (None, "") else None
        address = (r.get("Address") or "").strip() if isinstance(r.get("Address"), str) else None
        city = (r.get("City") or "").strip() if isinstance(r.get("City"), str) else None
        zip_code = (r.get("ZIP Code") or "").strip() if isinstance(r.get("ZIP Code"), str) else None

        existing = db.scalar(select(Customer).where(Customer.name == name))
        if existing is None:
            existing = Customer(
                code=code_str,
                name=name,
                phone=phone,
                address=address,
                city=city,
                zip_code=zip_code,
            )
            db.add(existing)
            db.flush()
        else:
            existing.code = existing.code or code_str
            existing.phone = existing.phone or phone
            existing.address = existing.address or address
            existing.city = existing.city or city
            existing.zip_code = existing.zip_code or zip_code

        if code is not None:
            mapping[code] = existing.id

    print(f"Imported customers: {len(mapping)}")
    return mapping


def apply_receipts_and_store(
    db: Session,
    storage_rows: list[dict],
    product_by_sku: dict[str, Product],
    receipt_dt: datetime,
) -> None:
    for r in storage_rows:
        sku = (r.get("Item Code") or "").strip() if isinstance(r.get("Item Code"), str) else ""
        if not sku:
            continue

        product = product_by_sku.get(sku)
        if product is None:
            product = Product(
                sku=sku,
                name=sku,
                uom="Pc",
                uom_multiplier=1,
                unit_price=Decimal("0"),
                currency=settings.DEFAULT_CURRENCY,
                quantity_on_hand=0,
                is_active=True,
            )
            db.add(product)
            db.flush()
            product_by_sku[sku] = product

        receipt_raw = r.get("Receipt")
        receipt_qty = int(receipt_raw) if receipt_raw not in (None, "") else 0
        if receipt_qty != 0:
            db.add(
                StockMovement(
                    product_id=product.id,
                    movement_type=StockMovementType.IN,
                    quantity_delta=receipt_qty,
                    note="Imported receipt total",
                    created_at=receipt_dt,
                )
            )
            product.quantity_on_hand += receipt_qty


def import_issue_log(
    db: Session,
    issue_rows: list[dict],
    product_by_sku: dict[str, Product],
    client_code_to_customer_id: dict[int, int],
    *,
    skip_existing_invoices: bool,
) -> None:
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in issue_rows:
        sku = (r.get("Item Code") or "").strip() if isinstance(r.get("Item Code"), str) else ""
        if not sku:
            continue
        inv_raw = r.get("Invoice No.")
        invoice_number = normalize_invoice_number(inv_raw)
        if not invoice_number:
            continue
        groups[invoice_number].append(r)

    for invoice_number in sorted(groups.keys()):
        lines = groups[invoice_number]
        first = lines[0]
        line_dates = [parse_date_to_dt(r.get("Date") or first.get("Date")) for r in lines]
        issued_dt = min(line_dates) if line_dates else parse_date_to_dt(first.get("Date"))
        customer_id = _resolve_customer_id(db, first, client_code_to_customer_id)
        _upsert_customer_from_row(db, customer_id, first)
        if skip_existing_invoices:
            existing = db.scalar(select(Invoice).where(Invoice.invoice_number == invoice_number))
            if existing is not None:
                continue

        def _first_nonempty_str(field: str) -> str | None:
            for r in lines:
                v = r.get(field)
                if isinstance(v, str) and v.strip():
                    return v.strip()
            return None

        issue_log_no = None
        no_raw = first.get("No.")
        try:
            issue_log_no = int(no_raw) if no_raw not in (None, "") else None
        except Exception:
            issue_log_no = None

        sale = SaleOrder(
            customer_id=customer_id,
            status=SaleStatus.CONFIRMED,
            currency=settings.DEFAULT_CURRENCY,
            tax_rate=Decimal("0"),
            subtotal_amount=Decimal("0"),
            tax_amount=Decimal("0"),
            total_amount=Decimal("0"),
            created_at=issued_dt,
            updated_at=issued_dt,
        )
        db.add(sale)
        db.flush()

        subtotal = Decimal("0")
        sale_lines: list[SaleOrderLine] = []
        inv_lines: list[InvoiceLine] = []
        stock_moves: list[StockMovement] = []

        for row in lines:
            sku = (row.get("Item Code") or "").strip() if isinstance(row.get("Item Code"), str) else ""
            if not sku:
                continue
            row_dt = parse_date_to_dt(row.get("Date") or first.get("Date"))
            product = product_by_sku.get(sku)
            if product is None:
                product = Product(
                    sku=sku,
                    name=(row.get("Item Description") or sku).strip()
                    if isinstance(row.get("Item Description"), str)
                    else sku,
                    uom=(row.get("UOM") or row.get("Unit of Measurement") or "Pc").strip()
                    if isinstance((row.get("UOM") or row.get("Unit of Measurement")), str)
                    else "Pc",
                    uom_multiplier=12
                    if str((row.get("UOM") or row.get("Unit of Measurement") or "")).strip().lower() == "dozen"
                    else 1,
                    unit_price=Decimal("0"),
                    currency=settings.DEFAULT_CURRENCY,
                    quantity_on_hand=0,
                    is_active=True,
                )
                db.add(product)
                db.flush()
                product_by_sku[sku] = product

            uom = row.get("UOM") or row.get("Unit of Measurement") or product.uom or "Pc"
            if isinstance(uom, str) and uom.strip() and product.uom != uom.strip():
                product.uom = uom.strip()
                product.uom_multiplier = 12 if product.uom.lower() == "dozen" else 1

            qty = parse_int(row.get("Quantity"))
            unit_price = parse_money(row.get("Unit Price"))
            line_total = parse_money(row.get("Total"))
            if line_total == Decimal("0") and qty and unit_price:
                line_total = unit_price * Decimal(qty)
            subtotal += line_total

            sale_line = SaleOrderLine(
                sale_order_id=sale.id,
                product_id=product.id,
                sku=product.sku,
                product_name=(row.get("Item Description") or product.name or sku).strip()
                if isinstance(row.get("Item Description"), str)
                else (product.name or sku),
                quantity=qty,
                unit_price=unit_price,
                line_total=line_total,
            )
            sale_lines.append(sale_line)

            inv_lines.append(
                InvoiceLine(
                    product_id=product.id,
                    sku=sale_line.sku,
                    product_name=sale_line.product_name,
                    uom=(row.get("UOM") or row.get("Unit of Measurement") or product.uom or "Pc").strip()
                    if isinstance((row.get("UOM") or row.get("Unit of Measurement") or product.uom), str)
                    else (product.uom or "Pc"),
                    line_date=row_dt,
                    quantity=sale_line.quantity,
                    unit_price=sale_line.unit_price,
                    line_total=sale_line.line_total,
                )
            )

            base_qty = qty * int(product.uom_multiplier or 1)
            stock_moves.append(
                StockMovement(
                    product_id=product.id,
                    movement_type=StockMovementType.OUT,
                    quantity_delta=-base_qty,
                    note=f"Imported invoice {invoice_number}",
                    created_at=row_dt,
                )
            )
            product.quantity_on_hand -= base_qty

        sale.subtotal_amount = subtotal
        sale.tax_amount = Decimal("0")
        sale.total_amount = subtotal
        db.add_all(sale_lines)

        invoice = Invoice(
            sale_order_id=sale.id,
            invoice_number=invoice_number,
            gin_number=(first.get("GIN No.") or "").strip() if isinstance(first.get("GIN No."), str) else None,
            issue_log_no=issue_log_no,
            client_code_snapshot=_first_nonempty_str("Client Code"),
            client_name_snapshot=_first_nonempty_str("Client"),
            tele_snapshot=_first_nonempty_str("Tele"),
            address_snapshot=_first_nonempty_str("Address"),
            city_snapshot=_first_nonempty_str("City"),
            zip_code_snapshot=_first_nonempty_str("ZIP Code"),
            issued_at=issued_dt,
            due_at=None,
            status=InvoiceStatus.ISSUED,
            currency=sale.currency,
            tax_rate=sale.tax_rate,
            subtotal_amount=sale.subtotal_amount,
            tax_amount=sale.tax_amount,
            total_amount=sale.total_amount,
            created_at=issued_dt,
            updated_at=issued_dt,
        )
        invoice.lines = inv_lines
        db.add(invoice)
        db.add_all(stock_moves)


def import_amazon_issue(db: Session, amazon_rows: list[dict], product_by_sku: dict[str, Product]) -> None:
    for r in amazon_rows:
        sku = (r.get("Product Code") or "").strip() if isinstance(r.get("Product Code"), str) else ""
        if not sku:
            continue
        product = product_by_sku.get(sku)
        if product is None:
            product = Product(
                sku=sku,
                name=(r.get("Product Name") or sku).strip() if isinstance(r.get("Product Name"), str) else sku,
                uom="Pc",
                uom_multiplier=1,
                unit_price=Decimal("0"),
                currency=settings.DEFAULT_CURRENCY,
                quantity_on_hand=0,
                is_active=True,
            )
            db.add(product)
            db.flush()
            product_by_sku[sku] = product

        qty = int(r.get("Quantity") or 0)
        if qty == 0:
            continue
        dt = _excel_date_to_dt(r.get("Date"))
        fulfil = (r.get("Fulfilment Method") or "").strip() if isinstance(r.get("Fulfilment Method"), str) else ""
        base_qty = qty * int(product.uom_multiplier or 1)
        db.add(
            StockMovement(
                product_id=product.id,
                movement_type=StockMovementType.OUT,
                quantity_delta=-base_qty,
                note=f"Amazon issue {fulfil}".strip(),
                created_at=dt,
            )
        )
        product.quantity_on_hand -= base_qty


def reconcile_stock(db: Session, storage_rows: list[dict], product_by_sku: dict[str, Product]) -> None:
    for r in storage_rows:
        sku = (r.get("Item Code") or "").strip() if isinstance(r.get("Item Code"), str) else ""
        if not sku:
            continue
        store_raw = r.get("Store")
        try:
            expected = int(store_raw) if store_raw not in (None, "") else 0
        except Exception:
            expected = 0

        product = product_by_sku.get(sku)
        if product is None:
            continue

        diff = expected - int(product.quantity_on_hand)
        if diff == 0:
            continue
        now = datetime.now(timezone.utc)
        db.add(
            StockMovement(
                product_id=product.id,
                movement_type=StockMovementType.ADJUST,
                quantity_delta=diff,
                note="Imported reconcile to Storage Count",
                created_at=now,
            )
        )
        product.quantity_on_hand += diff


def _find_earliest_log_date(issue_rows: list[dict], amazon_rows: list[dict]) -> date | None:
    dates: list[date] = []
    for r in issue_rows:
        d = _excel_date_to_date(r.get("Date"))
        if d:
            dates.append(d)
    for r in amazon_rows:
        d = _excel_date_to_date(r.get("Date"))
        if d:
            dates.append(d)
    return min(dates) if dates else None


def _excel_date_to_date(v) -> date | None:  # type: ignore[no-untyped-def]
    if v in (None, ""):
        return None
    try:
        serial = int(v)
    except Exception:
        try:
            serial = int(Decimal(str(v)))
        except Exception:
            return None
    base = date(1899, 12, 30)
    return base + timedelta(days=serial)


def _excel_date_to_dt(v) -> datetime:  # type: ignore[no-untyped-def]
    d = _excel_date_to_date(v) or datetime.now(timezone.utc).date()
    return datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc)


def _resolve_customer_id(db: Session, first_row: dict, code_map: dict[int, int]) -> int | None:
    code_raw = first_row.get("Client Code")
    code = None
    try:
        code = int(code_raw) if code_raw is not None else None
    except Exception:
        code = None
    if code is None and isinstance(code_raw, str):
        s = code_raw.strip()
        if s:
            existing_by_code = db.scalar(select(Customer).where(Customer.code == s))
            if existing_by_code is not None:
                return existing_by_code.id
            digits = "".join(ch for ch in s if ch.isdigit())
            if digits.isdigit():
                code = int(digits)
    if code is not None and code in code_map:
        return code_map[code]

    name = (first_row.get("Client") or "").strip() if isinstance(first_row.get("Client"), str) else ""
    if not name:
        return None
    existing = db.scalar(select(Customer).where(Customer.name == name))
    if existing is None:
        existing = Customer(name=name)
        db.add(existing)
        db.flush()
    return existing.id


def read_issue_log_csv(path: Path) -> list[dict]:
    if not path.is_file():
        raise RuntimeError(f"Issue log CSV not found: {path}")

    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return []

        required = {"Invoice No.", "Date", "Client", "Item Code", "Item Description", "UOM", "Quantity", "Unit Price", "Total"}
        missing = [h for h in sorted(required) if h not in set(reader.fieldnames)]
        if missing:
            raise RuntimeError(f"Missing headers in issue log CSV: {missing}")

        rows: list[dict] = []
        for r in reader:
            item_code = (r.get("Item Code") or "").strip()
            invoice_no = (r.get("Invoice No.") or "").strip()
            if not item_code or not invoice_no:
                continue
            rows.append(r)

    print(f"Issue log CSV rows used: {len(rows)}")
    return rows


def normalize_invoice_number(v) -> str:  # type: ignore[no-untyped-def]
    if v in (None, ""):
        return ""
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return ""
        # already looks like UL0008
        if any(c.isalpha() for c in s) and any(c.isdigit() for c in s):
            return s
        if s.isdigit():
            n = int(s)
            return f"{settings.INVOICE_PREFIX}{n:0{settings.INVOICE_NUMBER_DIGITS}d}"
        return s

    try:
        n = int(v)
    except Exception:
        try:
            n = int(Decimal(str(v)))
        except Exception:
            return ""
    return f"{settings.INVOICE_PREFIX}{n:0{settings.INVOICE_NUMBER_DIGITS}d}"


def parse_date_to_dt(v) -> datetime:  # type: ignore[no-untyped-def]
    if v in (None, ""):
        return datetime.now(timezone.utc)
    if isinstance(v, str):
        s = v.strip()
        for fmt in ("%m/%d/%y", "%m/%d/%Y", "%Y-%m-%d"):
            try:
                d = datetime.strptime(s, fmt).date()
                return datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc)
            except ValueError:
                continue
        # fallback: try excel serial in string
        try:
            return _excel_date_to_dt(Decimal(s))
        except Exception:
            return datetime.now(timezone.utc)
    return _excel_date_to_dt(v)


def parse_int(v) -> int:  # type: ignore[no-untyped-def]
    if v in (None, ""):
        return 0
    if isinstance(v, int):
        return v
    if isinstance(v, Decimal):
        return int(v)
    if isinstance(v, str):
        s = v.strip().replace(",", "")
        if s == "":
            return 0
        try:
            return int(Decimal(s))
        except Exception:
            return 0
    try:
        return int(v)
    except Exception:
        return 0


def parse_money(v) -> Decimal:  # type: ignore[no-untyped-def]
    if v in (None, ""):
        return Decimal("0")
    if isinstance(v, Decimal):
        return v
    if isinstance(v, (int, float)):
        return Decimal(str(v))
    if isinstance(v, str):
        s = v.strip()
        if s == "":
            return Decimal("0")
        s = s.replace("$", "").replace(",", "")
        if s.startswith("(") and s.endswith(")"):
            s = "-" + s[1:-1]
        try:
            return Decimal(s)
        except Exception:
            return Decimal("0")
    try:
        return Decimal(str(v))
    except Exception:
        return Decimal("0")


def _upsert_customer_from_row(db: Session, customer_id: int | None, row: dict) -> None:
    if customer_id is None:
        return
    cust = db.get(Customer, customer_id)
    if cust is None:
        return
    code = row.get("Client Code")
    if isinstance(code, str) and code.strip() and not cust.code:
        cust.code = code.strip()
    phone = row.get("Tele")
    if isinstance(phone, str) and phone.strip() and not cust.phone:
        cust.phone = phone.strip()
    address = row.get("Address")
    if isinstance(address, str) and address.strip() and not cust.address:
        cust.address = address.strip()
    city = row.get("City")
    if isinstance(city, str) and city.strip() and not cust.city:
        cust.city = city.strip()
    zip_code = row.get("ZIP Code")
    if isinstance(zip_code, str) and zip_code.strip() and not cust.zip_code:
        cust.zip_code = zip_code.strip()


if __name__ == "__main__":
    raise SystemExit(main())
