from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.db.models import Customer, Invoice, InvoiceLine, InvoicePayment, InvoiceStatus, Product, SaleOrder, SaleStatus, User
from app.schemas.invoice import InvoiceCreateFromSale, InvoicePaymentCreate, InvoicePaymentRead, InvoiceRead, InvoiceUpdate
from app.services.money import quantize_money
from app.services.invoice_render import render_invoice_pdf


router = APIRouter(prefix="/invoices")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


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


def _sync_invoice_status(invoice: Invoice) -> None:
    if invoice.status == InvoiceStatus.VOID:
        return
    invoice.status = InvoiceStatus.PAID if invoice.balance_due <= Decimal("0") else InvoiceStatus.ISSUED


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
    invoice = _load_invoice(db, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")

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
    for field in ("client_name_snapshot", "tele_snapshot", "address_snapshot", "city_snapshot", "zip_code_snapshot"):
        if field in data:
            setattr(invoice, field, data[field])
    if "tax_rate" in data and data["tax_rate"] is not None:
        invoice.tax_rate = Decimal(data["tax_rate"])
    if "order_discount_amount" in data and data["order_discount_amount"] is not None:
        invoice.order_discount_amount = Decimal(data["order_discount_amount"])
    if "shipping_amount" in data and data["shipping_amount"] is not None:
        invoice.shipping_amount = Decimal(data["shipping_amount"])
    if "lines" in data and data["lines"] is not None:
        payload_lines = data["lines"]
        existing_lines = {line.id: line for line in invoice.lines}
        missing_ids = [str(line_data["id"]) for line_data in payload_lines if line_data["id"] not in existing_lines]
        if missing_ids:
            raise HTTPException(status_code=400, detail=f"Unknown invoice line id(s): {', '.join(missing_ids)}")
        for line_data in payload_lines:
            line = existing_lines[line_data["id"]]
            line.sku = line_data["sku"].strip()
            line.product_name = line_data["product_name"].strip()
            line.uom = line_data["uom"].strip()
            line.quantity = int(line_data["quantity"])
            line.unit_price = Decimal(line_data["unit_price"])
            line.discount_amount = Decimal(line_data["discount_amount"])

    _sync_invoice_totals(invoice)
    _sync_invoice_status(invoice)

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail="Invoice number already exists") from e

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
    filename = f"{invoice.invoice_number} - {buyer_slug}.pdf"
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
