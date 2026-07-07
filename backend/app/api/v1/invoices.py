from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.db.models import Customer, Invoice, InvoiceLine, InvoiceLineType, InvoicePayment, InvoiceStatus, Product, SaleOrder, SaleStatus, User
from app.schemas.invoice import InvoiceCreateFromSale, InvoiceLineInput, InvoiceManualCreate, InvoiceMergeCreate, InvoicePaymentCreate, InvoicePaymentRead, InvoiceRead, InvoiceUpdate
from app.services.excel_invoice import ExcelImportError, XLSX_MIME, build_manual_invoice_template_xlsx, parse_manual_invoice_import_xlsx
from app.services.money import quantize_money
from app.services.invoice_render import render_invoice_pdf


router = APIRouter(prefix="/invoices")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _raise_invoice_integrity_error(e: IntegrityError) -> None:
    message = str(getattr(e, "orig", e))
    lowered = message.lower()
    if "invoice_number" in lowered and ("unique" in lowered or "already exists" in lowered):
        raise HTTPException(status_code=409, detail="Invoice number already exists") from e
    if "sale_order_id" in lowered and "not null" in lowered:
        raise HTTPException(status_code=500, detail="Database schema is outdated for manual invoices. Please restart backend to run migrations.") from e
    raise HTTPException(status_code=409, detail=message) from e


def _parse_invoice_seq(invoice_number: str, prefix: str) -> int | None:
    if not invoice_number:
        return None
    if invoice_number.startswith(prefix):
        tail = invoice_number[len(prefix) :]
    else:
        tail = invoice_number
    tail = tail.strip()
    if not tail.isdigit():
        return None
    return int(tail)


def _generate_invoice_number(db: Session, prefix: str, digits: int) -> str:
    prefix = (prefix or "").strip() or "UL"
    digits = int(digits or 4)
    if digits < 1 or digits > 12:
        digits = 4

    existing = db.scalars(select(Invoice.invoice_number).where(Invoice.invoice_number.like(f"{prefix}%"))).all()
    max_seq = 0
    for inv_no in existing:
        seq = _parse_invoice_seq(inv_no, prefix)
        if seq is not None and seq > max_seq:
            max_seq = seq
    next_seq = max_seq + 1
    return f"{prefix}{next_seq:0{digits}d}"


def _load_invoice(db: Session, invoice_id: int) -> Invoice | None:
    stmt = (
        select(Invoice)
        .where(Invoice.id == invoice_id)
        .options(
            selectinload(Invoice.lines),
            selectinload(Invoice.payments),
            selectinload(Invoice.sale_order).selectinload(SaleOrder.customer),
        )
    )
    return db.scalar(stmt)


def _safe_filename_part(value: str) -> str:
    cleaned = re.sub(r"[^\w\s.-]+", " ", value, flags=re.UNICODE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().strip(".")
    return cleaned or "customer"


def _normalize_line_type(value: object) -> InvoiceLineType:
    if isinstance(value, InvoiceLineType):
        return value
    return InvoiceLineType(str(value or InvoiceLineType.PRODUCT.value).upper())


def _apply_invoice_line(
    line: InvoiceLine,
    line_data: InvoiceLineInput | dict[str, object],
    *,
    default_product_id: int | None = None,
) -> None:
    payload = line_data.model_dump() if isinstance(line_data, InvoiceLineInput) else line_data
    line_type = _normalize_line_type(payload.get("line_type"))
    product_name = str(payload.get("product_name") or "").strip()
    uom = str(payload.get("uom") or "").strip()
    sku = str(payload.get("sku") or "").strip()
    quantity = int(payload.get("quantity") or 0)
    unit_price = Decimal(payload.get("unit_price") or 0)
    discount_amount = Decimal(payload.get("discount_amount") or 0)
    product_id = payload.get("product_id")

    if not product_name:
        raise HTTPException(status_code=400, detail="Invoice line description must not be empty")
    if not uom:
        raise HTTPException(status_code=400, detail=f"Invoice line UOM is required for {product_name}")
    if quantity < 1:
        raise HTTPException(status_code=400, detail=f"Invoice line quantity must be at least 1 for {product_name}")

    resolved_product_id = int(product_id) if product_id is not None else default_product_id
    if line_type == InvoiceLineType.PRODUCT and resolved_product_id is None:
        raise HTTPException(status_code=400, detail=f"Product line must include product_id for {product_name}")

    line.line_type = line_type
    line.product_id = resolved_product_id if line_type == InvoiceLineType.PRODUCT else None
    line.sku = sku if line_type == InvoiceLineType.PRODUCT else sku
    line.product_name = product_name
    line.uom = uom
    line.quantity = quantity
    line.unit_price = unit_price
    line.discount_amount = discount_amount


def _sync_invoice_totals(invoice: Invoice) -> None:
    subtotal = Decimal("0")
    line_discounts_total = Decimal("0")

    for line in invoice.lines:
        unit_price = quantize_money(Decimal(line.unit_price or 0))
        line_discount = quantize_money(Decimal(line.discount_amount or 0))
        line_subtotal = quantize_money(unit_price * Decimal(line.quantity))
        if line_discount > line_subtotal:
            raise HTTPException(status_code=400, detail=f"Line discount exceeds subtotal for SKU {line.sku}")
        line.unit_price = unit_price
        line.discount_amount = line_discount
        line.line_total = quantize_money(line_subtotal - line_discount)
        subtotal += line_subtotal
        line_discounts_total += line_discount

    invoice.subtotal_amount = quantize_money(subtotal)
    invoice.order_discount_amount = quantize_money(Decimal(invoice.order_discount_amount or 0))
    invoice.shipping_amount = quantize_money(Decimal(invoice.shipping_amount or 0))
    invoice.tax_rate = Decimal(invoice.tax_rate or 0)
    invoice.discount_amount = quantize_money(invoice.order_discount_amount + line_discounts_total)

    net = invoice.subtotal_amount - invoice.discount_amount
    if net < 0:
        raise HTTPException(status_code=400, detail="discount_amount cannot exceed subtotal")

    invoice.tax_amount = quantize_money(net * invoice.tax_rate)
    invoice.total_amount = quantize_money(net + invoice.tax_amount + invoice.shipping_amount)


def _sync_invoice_status(invoice: Invoice, *, requested_status: InvoiceStatus | None = None) -> None:
    target_status = requested_status or invoice.status
    if target_status == InvoiceStatus.VOID:
        invoice.status = InvoiceStatus.VOID
        return
    if target_status == InvoiceStatus.DRAFT:
        invoice.status = InvoiceStatus.DRAFT
        return
    invoice.status = InvoiceStatus.PAID if invoice.balance_due <= Decimal("0") else InvoiceStatus.ISSUED


def _resolved_customer_name(invoice: Invoice) -> str:
    return (invoice.customer_name or "").strip()


def _validate_merge_candidates(invoices: list[Invoice]) -> None:
    if len(invoices) < 2:
        raise HTTPException(status_code=400, detail="Select at least 2 invoices to merge")

    first = invoices[0]
    customer_name = _resolved_customer_name(first).casefold()
    currency = (first.currency or "").upper()
    tax_rate = Decimal(first.tax_rate or 0)

    for invoice in invoices:
        if invoice.merged_into_invoice_id is not None:
            raise HTTPException(status_code=400, detail=f"Invoice {invoice.invoice_number} has already been merged")
        if invoice.status == InvoiceStatus.DRAFT:
            raise HTTPException(status_code=400, detail=f"Invoice {invoice.invoice_number} is still DRAFT")
        if invoice.status == InvoiceStatus.VOID:
            raise HTTPException(status_code=400, detail=f"Invoice {invoice.invoice_number} is VOID and cannot be merged")
        if invoice.amount_paid > Decimal("0"):
            raise HTTPException(status_code=400, detail=f"Invoice {invoice.invoice_number} already has payments")
        if _resolved_customer_name(invoice).casefold() != customer_name:
            raise HTTPException(status_code=400, detail="All selected invoices must belong to the same customer")
        if (invoice.currency or "").upper() != currency:
            raise HTTPException(status_code=400, detail="All selected invoices must use the same currency")
        if Decimal(invoice.tax_rate or 0) != tax_rate:
            raise HTTPException(status_code=400, detail="All selected invoices must use the same tax rate")


@router.get("", response_model=list[InvoiceRead])
def list_invoices(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> list[Invoice]:
    stmt = (
        select(Invoice)
        .options(
            selectinload(Invoice.lines),
            selectinload(Invoice.payments),
            selectinload(Invoice.sale_order).selectinload(SaleOrder.customer),
        )
        .order_by(Invoice.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return db.scalars(stmt).all()


@router.get("/manual/template.xlsx")
def download_manual_invoice_template() -> Response:
    try:
        xlsx = build_manual_invoice_template_xlsx()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return Response(
        content=xlsx,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": 'attachment; filename="free-invoice-template.xlsx"'},
    )


@router.post("/manual/import")
async def import_manual_invoice_xlsx(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    _ = current_user
    content = await file.read()
    products = db.scalars(select(Product)).all()
    products_by_sku = {product.sku.upper(): product for product in products}
    products_by_id = {product.id: product for product in products}
    try:
        return parse_manual_invoice_import_xlsx(
            content,
            products_by_sku=products_by_sku,
            products_by_id=products_by_id,
        )
    except ExcelImportError as e:
        raise HTTPException(status_code=400, detail="\n".join(e.errors)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.post("/manual", response_model=InvoiceRead, status_code=status.HTTP_201_CREATED)
def create_manual_invoice(
    body: InvoiceManualCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Invoice:
    _ = current_user
    invoice_number = (body.invoice_number or "").strip() or _generate_invoice_number(
        db,
        settings.INVOICE_PREFIX,
        settings.INVOICE_NUMBER_DIGITS,
    )
    invoice = Invoice(
        sale_order_id=None,
        invoice_number=invoice_number,
        issued_at=body.issued_at or _utcnow(),
        due_at=body.due_at,
        status=body.status,
        currency=(body.currency or settings.DEFAULT_CURRENCY).strip().upper(),
        tax_rate=Decimal(body.tax_rate),
        order_discount_amount=Decimal(body.order_discount_amount),
        shipping_amount=Decimal(body.shipping_amount),
        client_name_snapshot=body.client_name_snapshot.strip(),
        tele_snapshot=(body.tele_snapshot or "").strip() or None,
        address_snapshot=(body.address_snapshot or "").strip() or None,
        city_snapshot=(body.city_snapshot or "").strip() or None,
        zip_code_snapshot=(body.zip_code_snapshot or "").strip() or None,
        note=(body.note or "").strip() or None,
    )
    invoice.lines = []
    for index, line_in in enumerate(body.lines):
        line = InvoiceLine()
        _apply_invoice_line(line, line_in)
        line.order_index = index
        invoice.lines.append(line)

    _sync_invoice_totals(invoice)
    _sync_invoice_status(invoice, requested_status=body.status)
    db.add(invoice)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        _raise_invoice_integrity_error(e)

    created = _load_invoice(db, invoice.id)
    assert created is not None
    return created


@router.get("/{invoice_id}", response_model=InvoiceRead)
def get_invoice(invoice_id: int, db: Session = Depends(get_db)) -> Invoice:
    invoice = _load_invoice(db, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


@router.patch("/{invoice_id}", response_model=InvoiceRead)
def patch_invoice(
    invoice_id: int,
    body: InvoiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Invoice:
    _ = current_user
    invoice = _load_invoice(db, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.merged_into_invoice_id is not None:
        raise HTTPException(status_code=400, detail="Merged source invoices cannot be edited")

    data = body.model_dump(exclude_unset=True)
    if "invoice_number" in data:
        invoice_number = (data["invoice_number"] or "").strip()
        if not invoice_number:
            raise HTTPException(status_code=400, detail="invoice_number must not be empty")
        invoice.invoice_number = invoice_number
    if "issued_at" in data and data["issued_at"] is not None:
        invoice.issued_at = data["issued_at"]
    if "due_at" in data:
        invoice.due_at = data["due_at"]
    if "status" in data and data["status"] is not None:
        invoice.status = data["status"]
    for field in ("client_name_snapshot", "tele_snapshot", "address_snapshot", "city_snapshot", "zip_code_snapshot", "note"):
        if field in data:
            value = data[field]
            setattr(invoice, field, (value or "").strip() or None if isinstance(value, str) or value is None else value)
    if "currency" in data and data["currency"] is not None:
        invoice.currency = str(data["currency"]).strip().upper()
    if "tax_rate" in data and data["tax_rate"] is not None:
        invoice.tax_rate = Decimal(data["tax_rate"])
    if "order_discount_amount" in data and data["order_discount_amount"] is not None:
        invoice.order_discount_amount = Decimal(data["order_discount_amount"])
    if "shipping_amount" in data and data["shipping_amount"] is not None:
        invoice.shipping_amount = Decimal(data["shipping_amount"])
    if "lines" in data and data["lines"] is not None:
        payload_lines = [InvoiceLineInput.model_validate(line_data) for line_data in data["lines"]]
        existing_lines = {line.id: line for line in invoice.lines}
        missing_ids = [str(line_data.id) for line_data in payload_lines if line_data.id is not None and line_data.id not in existing_lines]
        if missing_ids:
            raise HTTPException(status_code=400, detail=f"Unknown invoice line id(s): {', '.join(missing_ids)}")
        next_lines: list[InvoiceLine] = []
        for index, line_data in enumerate(payload_lines):
            if line_data.id is not None:
                line = existing_lines[line_data.id]
                default_product_id = line.product_id
            else:
                line = InvoiceLine(invoice_id=invoice.id)
                default_product_id = None
            _apply_invoice_line(line, line_data, default_product_id=default_product_id)
            line.order_index = index
            next_lines.append(line)
        invoice.lines = next_lines

    requested_status = data["status"] if "status" in data and data["status"] is not None else invoice.status
    _sync_invoice_totals(invoice)
    _sync_invoice_status(invoice, requested_status=requested_status)

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        _raise_invoice_integrity_error(e)

    updated = _load_invoice(db, invoice.id)
    assert updated is not None
    return updated


@router.post("/{invoice_id}/payments", response_model=InvoicePaymentRead, status_code=status.HTTP_201_CREATED)
def create_invoice_payment(
    invoice_id: int,
    body: InvoicePaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoicePayment:
    invoice = _load_invoice(db, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status == InvoiceStatus.VOID:
        raise HTTPException(status_code=400, detail="Cannot record payment for a VOID invoice")
    if invoice.status == InvoiceStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Cannot record payment for a DRAFT invoice")

    payment = InvoicePayment(
        invoice_id=invoice.id,
        paid_at=body.paid_at or _utcnow(),
        amount=quantize_money(Decimal(body.amount)),
        method=(body.method or "").strip() or None,
        note=(body.note or "").strip() or None,
        created_by=current_user.username,
    )
    db.add(payment)
    db.flush()
    invoice.payments.append(payment)
    _sync_invoice_status(invoice)
    db.commit()
    db.refresh(payment)
    return payment


@router.post("/from-sale/{sale_order_id}", response_model=InvoiceRead, status_code=status.HTTP_201_CREATED)
def create_invoice_from_sale(
    sale_order_id: int,
    body: InvoiceCreateFromSale,
    db: Session = Depends(get_db),
) -> Invoice:
    sale_stmt = (
        select(SaleOrder)
        .where(SaleOrder.id == sale_order_id)
        .options(selectinload(SaleOrder.lines), selectinload(SaleOrder.customer))
    )
    sale = db.scalar(sale_stmt)
    if sale is None:
        raise HTTPException(status_code=404, detail="Sale order not found")
    if sale.status != SaleStatus.CONFIRMED:
        raise HTTPException(status_code=400, detail="Sale order must be CONFIRMED to issue invoice")
    if sale.invoice is not None:
        raise HTTPException(status_code=409, detail="Invoice already exists for this sale order")

    issued_at = _utcnow()
    due_at = issued_at + timedelta(days=body.due_days) if body.due_days else None

    for _ in range(5):
        invoice_number = _generate_invoice_number(db, settings.INVOICE_PREFIX, settings.INVOICE_NUMBER_DIGITS)
        invoice = Invoice(
            sale_order_id=sale.id,
            invoice_number=invoice_number,
            issued_at=issued_at,
            due_at=due_at,
            status=InvoiceStatus.ISSUED,
            currency=sale.currency,
            tax_rate=sale.tax_rate,
            subtotal_amount=sale.subtotal_amount,
            order_discount_amount=sale.order_discount_amount,
            discount_amount=sale.discount_amount,
            shipping_amount=sale.shipping_amount,
            tax_amount=sale.tax_amount,
            total_amount=sale.total_amount,
        )

        product_ids = {line.product_id for line in sale.lines}
        products = db.scalars(select(Product).where(Product.id.in_(product_ids))).all()
        uom_by_product_id = {p.id: (p.uom or "Pc") for p in products}

        invoice.lines = [
            InvoiceLine(
                line_type=InvoiceLineType.PRODUCT,
                product_id=line.product_id,
                sku=line.sku,
                product_name=line.product_name,
                uom=uom_by_product_id.get(line.product_id, "Pc"),
                quantity=line.quantity,
                unit_price=line.unit_price,
                discount_amount=getattr(line, "discount_amount", 0),
                line_total=line.line_total,
            )
            for line in sale.lines
        ]

        db.add(invoice)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue

        created = _load_invoice(db, invoice.id)
        assert created is not None
        return created

    raise HTTPException(status_code=500, detail="Failed to generate a unique invoice number")


@router.post("/merge", response_model=InvoiceRead, status_code=status.HTTP_201_CREATED)
def merge_invoices(
    body: InvoiceMergeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Invoice:
    _ = current_user
    invoice_ids = list(dict.fromkeys(body.invoice_ids))
    stmt = (
        select(Invoice)
        .where(Invoice.id.in_(invoice_ids))
        .options(
            selectinload(Invoice.lines),
            selectinload(Invoice.payments),
            selectinload(Invoice.sale_order).selectinload(SaleOrder.customer),
        )
    )
    invoices = db.scalars(stmt).all()
    if len(invoices) != len(invoice_ids):
        found_ids = {invoice.id for invoice in invoices}
        missing = [str(invoice_id) for invoice_id in invoice_ids if invoice_id not in found_ids]
        raise HTTPException(status_code=404, detail=f"Invoice not found: {', '.join(missing)}")

    invoices_by_id = {invoice.id: invoice for invoice in invoices}
    ordered_invoices = [invoices_by_id[invoice_id] for invoice_id in invoice_ids]
    _validate_merge_candidates(ordered_invoices)

    first = ordered_invoices[0]
    invoice_number = (body.invoice_number or "").strip() or _generate_invoice_number(
        db,
        settings.INVOICE_PREFIX,
        settings.INVOICE_NUMBER_DIGITS,
    )
    merged_invoice = Invoice(
        sale_order_id=None,
        invoice_number=invoice_number,
        issued_at=body.issued_at or max(invoice.issued_at for invoice in ordered_invoices),
        due_at=body.due_at
        if body.due_at is not None
        else max((invoice.due_at for invoice in ordered_invoices if invoice.due_at is not None), default=None),
        status=InvoiceStatus.ISSUED,
        currency=first.currency,
        tax_rate=first.tax_rate,
        subtotal_amount=quantize_money(sum(Decimal(inv.subtotal_amount or 0) for inv in ordered_invoices)),
        order_discount_amount=quantize_money(sum(Decimal(inv.order_discount_amount or 0) for inv in ordered_invoices)),
        discount_amount=quantize_money(sum(Decimal(inv.discount_amount or 0) for inv in ordered_invoices)),
        shipping_amount=quantize_money(sum(Decimal(inv.shipping_amount or 0) for inv in ordered_invoices)),
        tax_amount=quantize_money(sum(Decimal(inv.tax_amount or 0) for inv in ordered_invoices)),
        total_amount=quantize_money(sum(Decimal(inv.total_amount or 0) for inv in ordered_invoices)),
        client_code_snapshot=first.client_code_snapshot,
        client_name_snapshot=first.client_name_snapshot or first.customer_name,
        tele_snapshot=first.tele_snapshot,
        address_snapshot=first.address_snapshot,
        city_snapshot=first.city_snapshot,
        zip_code_snapshot=first.zip_code_snapshot,
        lines=[],
    )
    merged_lines: list[InvoiceLine] = []
    next_order_index = 0
    for invoice in ordered_invoices:
        for line in invoice.lines:
            merged_lines.append(
                InvoiceLine(
                    product_id=line.product_id,
                    line_type=line.line_type,
                    sku=line.sku,
                    product_name=line.product_name,
                    uom=line.uom,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    discount_amount=line.discount_amount,
                    line_total=line.line_total,
                    line_date=line.line_date,
                    order_index=next_order_index,
                )
            )
            next_order_index += 1
    merged_invoice.lines = merged_lines
    db.add(merged_invoice)
    db.flush()

    for invoice in ordered_invoices:
        invoice.status = InvoiceStatus.VOID
        invoice.merged_into_invoice_id = merged_invoice.id

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail="Invoice number already exists") from e

    created = _load_invoice(db, merged_invoice.id)
    assert created is not None
    return created


@router.get("/{invoice_id}/pdf")
def download_invoice_pdf(invoice_id: int, db: Session = Depends(get_db)) -> Response:
    invoice = _load_invoice(db, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")

    customer: Customer | None = invoice.sale_order.customer if invoice.sale_order else None
    try:
        pdf_bytes = render_invoice_pdf(invoice=invoice, customer=customer)
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e)) from e

    buyer_name = invoice.client_name_snapshot or (customer.name if customer else "Walk-in customer")
    buyer_slug = _safe_filename_part(buyer_name)
    note_slug = _safe_filename_part(invoice.note or "") if invoice.note else ""
    filename = f"{invoice.invoice_number} - {buyer_slug}"
    if note_slug and note_slug.lower() != "customer":
        filename = f"{filename} - {note_slug}"
    filename = f"{filename}.pdf"
    content_disposition = f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": content_disposition},
    )


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(invoice_id: int, db: Session = Depends(get_db)) -> None:
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    db.delete(invoice)
    db.commit()
