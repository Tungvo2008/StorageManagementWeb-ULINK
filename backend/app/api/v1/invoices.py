from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db
from app.core.config import settings
from app.db.models import Customer, Invoice, InvoiceLine, InvoiceStatus, Product, SaleOrder, SaleStatus
from app.schemas.invoice import InvoiceCreateFromSale, InvoiceRead, InvoiceUpdate
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
            selectinload(Invoice.sale_order).selectinload(SaleOrder.customer),
        )
    )
    return db.scalar(stmt)


@router.get("", response_model=list[InvoiceRead])
def list_invoices(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> list[Invoice]:
    stmt = (
        select(Invoice)
        .options(selectinload(Invoice.lines))
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
def patch_invoice(invoice_id: int, body: InvoiceUpdate, db: Session = Depends(get_db)) -> Invoice:
    invoice = db.get(Invoice, invoice_id)
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

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail="Invoice number already exists") from e

    updated = _load_invoice(db, invoice.id)
    assert updated is not None
    return updated


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

    filename = f"invoice-{invoice.invoice_number}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(invoice_id: int, db: Session = Depends(get_db)) -> None:
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    db.delete(invoice)
    db.commit()
