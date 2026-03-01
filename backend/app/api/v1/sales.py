from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db
from app.core.config import settings
from app.db.models import Product, SaleOrder, SaleOrderLine, SaleStatus, StockMovement, StockMovementType
from app.schemas.sale import SaleOrderCreate, SaleOrderRead
from app.services.money import quantize_money


router = APIRouter(prefix="/sales")


@router.get("", response_model=list[SaleOrderRead])
def list_sales(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> list[SaleOrder]:
    stmt = (
        select(SaleOrder)
        .options(selectinload(SaleOrder.lines))
        .order_by(SaleOrder.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return db.scalars(stmt).all()


@router.get("/{sale_order_id}", response_model=SaleOrderRead)
def get_sale(sale_order_id: int, db: Session = Depends(get_db)) -> SaleOrder:
    stmt = select(SaleOrder).where(SaleOrder.id == sale_order_id).options(selectinload(SaleOrder.lines))
    sale = db.scalar(stmt)
    if sale is None:
        raise HTTPException(status_code=404, detail="Sale order not found")
    return sale


@router.post("", response_model=SaleOrderRead, status_code=status.HTTP_201_CREATED)
def create_sale(order_in: SaleOrderCreate, db: Session = Depends(get_db)) -> SaleOrder:
    tax_rate = (
        Decimal(str(order_in.tax_rate))
        if order_in.tax_rate is not None
        else Decimal(str(settings.DEFAULT_TAX_RATE))
    )

    currency: str | None = order_in.currency
    subtotal = Decimal("0")
    line_discounts_total = Decimal("0")
    lines: list[SaleOrderLine] = []
    stock_movements: list[StockMovement] = []

    order_discount_amount = Decimal(str(order_in.discount_amount or 0))
    shipping_amount = Decimal(str(order_in.shipping_amount or 0))
    if order_discount_amount < 0 or shipping_amount < 0:
        raise HTTPException(status_code=400, detail="discount_amount/shipping_amount must be >= 0")

    sale = SaleOrder(
        customer_id=order_in.customer_id,
        status=order_in.status,
        currency=settings.DEFAULT_CURRENCY,  # cập nhật sau khi xác định currency
        tax_rate=tax_rate,
        subtotal_amount=Decimal("0"),
        order_discount_amount=Decimal("0"),
        discount_amount=Decimal("0"),
        shipping_amount=Decimal("0"),
        tax_amount=Decimal("0"),
        total_amount=Decimal("0"),
    )
    db.add(sale)
    db.flush()  # lấy sale.id

    for line_in in order_in.lines:
        product = db.get(Product, line_in.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail=f"Product {line_in.product_id} not found")
        if not product.is_active:
            raise HTTPException(status_code=400, detail=f"Product {product.id} is inactive")

        if currency is None:
            currency = product.currency
        elif product.currency != currency:
            raise HTTPException(status_code=400, detail="All products must have the same currency")

        base_qty = line_in.quantity * int(product.uom_multiplier or 1)

        if order_in.status == SaleStatus.CONFIRMED and product.quantity_on_hand < base_qty:
            raise HTTPException(status_code=400, detail=f"Not enough stock for product {product.sku}")

        unit_price = Decimal(product.unit_price)
        line_subtotal = unit_price * Decimal(line_in.quantity)
        line_discount = Decimal(str(getattr(line_in, "discount_amount", 0) or 0))
        if line_discount < 0:
            raise HTTPException(status_code=400, detail="Line discount_amount must be >= 0")
        if line_discount > line_subtotal:
            raise HTTPException(status_code=400, detail=f"Line discount exceeds subtotal for product {product.sku}")

        line_total = quantize_money(line_subtotal - line_discount)
        subtotal += quantize_money(line_subtotal)
        line_discounts_total += quantize_money(line_discount)

        line = SaleOrderLine(
            sale_order_id=sale.id,
            product_id=product.id,
            sku=product.sku,
            product_name=product.name,
            quantity=line_in.quantity,
            unit_price=unit_price,
            discount_amount=quantize_money(line_discount),
            line_total=line_total,
        )
        lines.append(line)

        if order_in.status == SaleStatus.CONFIRMED:
            product.quantity_on_hand -= base_qty
            stock_movements.append(
                StockMovement(
                    product_id=product.id,
                    sale_order_id=sale.id,
                    movement_type=StockMovementType.OUT,
                    quantity_delta=-base_qty,
                    note=f"Sale order #{sale.id}",
                )
            )

    if currency is None:
        currency = settings.DEFAULT_CURRENCY

    sale.currency = currency
    sale.subtotal_amount = quantize_money(subtotal)
    sale.order_discount_amount = quantize_money(order_discount_amount)
    sale.discount_amount = quantize_money(order_discount_amount + line_discounts_total)
    sale.shipping_amount = quantize_money(shipping_amount)

    net = sale.subtotal_amount - sale.discount_amount
    if net < 0:
        raise HTTPException(status_code=400, detail="discount_amount cannot exceed subtotal")

    sale.tax_amount = quantize_money(net * tax_rate)
    sale.total_amount = quantize_money(net + sale.tax_amount + sale.shipping_amount)

    db.add_all(lines)
    db.add_all(stock_movements)
    db.commit()

    stmt = select(SaleOrder).where(SaleOrder.id == sale.id).options(selectinload(SaleOrder.lines))
    created = db.scalar(stmt)
    assert created is not None
    return created
