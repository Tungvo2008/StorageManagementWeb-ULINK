from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.db.models import (
    Category,
    InventoryIssue,
    InventoryIssueLine,
    InventoryReceipt,
    InventoryReceiptLine,
    Product,
    StockMovement,
    StockMovementType,
    User,
)
from app.schemas.inventory import (
    InventoryIssueCreate,
    InventoryIssueRead,
    InventoryIssueUpdate,
    InventoryReceiptCreate,
    InventoryReceiptRead,
    InventoryReceiptSummaryRead,
    StockMovementCreate,
    StockMovementRead,
)
from app.services.money import quantize_money
from app.services.excel_inventory import (
    XLSX_MIME,
    ExcelImportError,
    build_issue_template_xlsx,
    build_receipt_template_xlsx,
    parse_issue_import_xlsx,
    parse_receipt_import_xlsx,
)


router = APIRouter(prefix="/inventory")

ISSUE_REF_PREFIX = "IS"
ISSUE_REF_DIGITS = 4


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_issue_seq(issue_number: str, prefix: str) -> int | None:
    if not issue_number:
        return None
    raw = issue_number.strip()
    tail = raw[len(prefix):] if raw.startswith(prefix) else raw
    if not tail.isdigit():
        return None
    return int(tail)


def _generate_issue_number(db: Session, *, prefix: str = ISSUE_REF_PREFIX, digits: int = ISSUE_REF_DIGITS) -> str:
    existing = db.scalars(select(InventoryIssue.issue_number).where(InventoryIssue.issue_number.is_not(None))).all()
    max_seq = 0
    for ref in existing:
        if not ref:
            continue
        seq = _parse_issue_seq(ref, prefix)
        if seq is not None and seq > max_seq:
            max_seq = seq
    next_seq = max_seq + 1
    return f"{prefix}{next_seq:0{digits}d}"


def _apply_moving_average_cost(*, product: Product, base_qty: int, line_total: Decimal) -> None:
    if base_qty <= 0:
        return

    old_qty = int(product.quantity_on_hand or 0)
    line_base_cost = quantize_money(line_total / Decimal(base_qty))

    if old_qty <= 0:
        product.cost_price = line_base_cost
        return

    total_qty = old_qty + base_qty
    if total_qty <= 0:
        product.cost_price = line_base_cost
        return

    old_cost = Decimal(product.cost_price or 0)
    weighted_total = (old_cost * Decimal(old_qty)) + line_total
    product.cost_price = quantize_money(weighted_total / Decimal(total_qty))


def _has_python_multipart() -> bool:
    try:
        import multipart  # type: ignore  # noqa: F401
    except Exception:
        return False
    return True


@router.get("/movements", response_model=list[StockMovementRead])
def list_stock_movements(skip: int = 0, limit: int = 200, db: Session = Depends(get_db)) -> list[StockMovement]:
    stmt = select(StockMovement).order_by(StockMovement.id.desc()).offset(skip).limit(limit)
    return db.scalars(stmt).all()


@router.post("/movements", response_model=StockMovementRead, status_code=status.HTTP_201_CREATED)
def create_stock_movement(movement_in: StockMovementCreate, db: Session = Depends(get_db)) -> StockMovement:
    if movement_in.quantity_delta == 0:
        raise HTTPException(status_code=400, detail="quantity_delta must not be 0")

    if movement_in.movement_type == StockMovementType.IN and movement_in.quantity_delta < 0:
        raise HTTPException(status_code=400, detail="IN movement requires positive quantity_delta")
    if movement_in.movement_type == StockMovementType.OUT and movement_in.quantity_delta > 0:
        raise HTTPException(status_code=400, detail="OUT movement requires negative quantity_delta")

    product = db.get(Product, movement_in.product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    new_qty = product.quantity_on_hand + movement_in.quantity_delta
    if new_qty < 0:
        raise HTTPException(status_code=400, detail="Not enough stock")

    product.quantity_on_hand = new_qty
    movement = StockMovement(
        product_id=movement_in.product_id,
        movement_type=movement_in.movement_type,
        quantity_delta=movement_in.quantity_delta,
        note=movement_in.note,
    )
    db.add(movement)
    db.commit()
    db.refresh(movement)
    return movement


@router.get("/receipts", response_model=list[InventoryReceiptRead])
def list_receipts(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> list[InventoryReceipt]:
    stmt = (
        select(InventoryReceipt)
        .options(selectinload(InventoryReceipt.lines))
        .order_by(InventoryReceipt.received_at.desc(), InventoryReceipt.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return db.scalars(stmt).all()


@router.delete("/receipts/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_receipt(receipt_id: int, db: Session = Depends(get_db)) -> None:
    receipt = db.get(InventoryReceipt, receipt_id)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")

    moves = db.scalars(select(StockMovement).where(StockMovement.receipt_id == receipt_id)).all()
    delta_by_product: dict[int, int] = {}
    for movement in moves:
        delta_by_product[movement.product_id] = delta_by_product.get(movement.product_id, 0) + int(movement.quantity_delta)

    if delta_by_product:
        products = db.scalars(select(Product).where(Product.id.in_(set(delta_by_product.keys())))).all()
        product_by_id = {p.id: p for p in products}
        for product_id, delta in delta_by_product.items():
            product = product_by_id.get(product_id)
            if product is not None:
                product.quantity_on_hand -= delta

    for movement in moves:
        db.delete(movement)
    db.delete(receipt)
    db.commit()


@router.get("/receipt-summary", response_model=list[InventoryReceiptSummaryRead])
def list_receipt_summary(db: Session = Depends(get_db)) -> list[InventoryReceiptSummaryRead]:
    stmt = (
        select(
            Product.id.label("product_id"),
            Product.sku.label("sku"),
            Product.name.label("product_name"),
            Category.id.label("category_id"),
            Category.name.label("category_name"),
            Product.base_uom.label("base_uom"),
            Product.uom.label("uom"),
            Product.uom_multiplier.label("uom_multiplier"),
            Product.currency.label("currency"),
            Product.quantity_on_hand.label("quantity_on_hand"),
            func.count(func.distinct(InventoryReceiptLine.receipt_id)).label("receipt_count"),
            func.count(InventoryReceiptLine.id).label("line_count"),
            func.coalesce(func.sum(InventoryReceiptLine.quantity * InventoryReceiptLine.uom_multiplier), 0).label(
                "total_received_base_qty"
            ),
            func.coalesce(func.sum(InventoryReceiptLine.line_total), Decimal("0")).label("total_received_amount"),
            func.max(InventoryReceipt.received_at).label("last_received_at"),
        )
        .join(InventoryReceiptLine, InventoryReceiptLine.product_id == Product.id)
        .join(InventoryReceipt, InventoryReceipt.id == InventoryReceiptLine.receipt_id)
        .outerjoin(Category, Category.id == Product.category_id)
        .group_by(
            Product.id,
            Product.sku,
            Product.name,
            Category.id,
            Category.name,
            Product.base_uom,
            Product.uom,
            Product.uom_multiplier,
            Product.currency,
            Product.quantity_on_hand,
        )
        .order_by(func.coalesce(Category.name, "No category").asc(), Product.name.asc(), Product.id.asc())
    )
    rows = db.execute(stmt).all()

    items: list[InventoryReceiptSummaryRead] = []
    for row in rows:
        multiplier = int(row.uom_multiplier or 1)
        if multiplier <= 0:
            multiplier = 1
        total_base_qty = int(row.total_received_base_qty or 0)
        total_sale_qty = Decimal(total_base_qty) / Decimal(multiplier)
        total_amount = quantize_money(Decimal(row.total_received_amount or 0))

        items.append(
            InventoryReceiptSummaryRead(
                product_id=int(row.product_id),
                sku=str(row.sku or ""),
                product_name=str(row.product_name or ""),
                category_id=int(row.category_id) if row.category_id is not None else None,
                category_name=str(row.category_name) if row.category_name is not None else None,
                base_uom=str(row.base_uom or "Pc"),
                uom=str(row.uom or "Pc"),
                uom_multiplier=multiplier,
                currency=str(row.currency or settings.DEFAULT_CURRENCY),
                quantity_on_hand=int(row.quantity_on_hand or 0),
                receipt_count=int(row.receipt_count or 0),
                line_count=int(row.line_count or 0),
                total_received_base_qty=total_base_qty,
                total_received_sale_qty=total_sale_qty,
                total_received_amount=total_amount,
                last_received_at=row.last_received_at,
            )
        )
    return items


@router.post("/receipts", response_model=InventoryReceiptRead, status_code=status.HTTP_201_CREATED)
def create_receipt(
    body: InventoryReceiptCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InventoryReceipt:
    return _create_receipt(body=body, db=db, actor_username=current_user.username)


def _create_receipt(*, body: InventoryReceiptCreate, db: Session, actor_username: str | None = None) -> InventoryReceipt:
    received_at = body.received_at or _utcnow()
    received_by = ((actor_username or "").strip() or (body.received_by or "").strip()) or None
    receipt = InventoryReceipt(
        receipt_number=(body.receipt_number or "").strip() or None,
        received_at=received_at,
        received_by=received_by,
        note=body.note,
    )
    db.add(receipt)
    db.flush()

    lines: list[InventoryReceiptLine] = []
    movements: list[StockMovement] = []

    for line_in in body.lines:
        product = db.get(Product, line_in.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail=f"Product {line_in.product_id} not found")
        if not product.is_active:
            raise HTTPException(status_code=400, detail=f"Product {product.id} is inactive")

        qty = int(line_in.quantity)
        unit = (getattr(line_in, "unit", None) or "SALE").upper()
        if unit not in {"BASE", "SALE"}:
            raise HTTPException(status_code=400, detail="Invalid unit (must be BASE or SALE)")
        multiplier = 1 if unit == "BASE" else int(product.uom_multiplier or 1)
        base_qty = qty * multiplier

        unit_cost = quantize_money(Decimal(line_in.unit_cost))
        currency = (product.currency or settings.DEFAULT_CURRENCY).upper()
        line_total = quantize_money(unit_cost * Decimal(qty))

        rec_line = InventoryReceiptLine(
            receipt_id=receipt.id,
            product_id=product.id,
            sku=product.sku,
            product_name=product.name,
            uom=(product.base_uom if unit == "BASE" else product.uom),
            uom_multiplier=multiplier,
            quantity=qty,
            unit_cost=unit_cost,
            currency=currency,
            line_total=line_total,
            note=line_in.note,
        )
        lines.append(rec_line)
        db.add(rec_line)
        db.flush()

        _apply_moving_average_cost(product=product, base_qty=base_qty, line_total=line_total)
        product.quantity_on_hand += base_qty

        movements.append(
            StockMovement(
                product_id=product.id,
                receipt_id=receipt.id,
                receipt_line_id=rec_line.id,
                movement_type=StockMovementType.IN,
                quantity_delta=base_qty,
                note=f"Receipt #{receipt.id}" + (f" ({receipt.receipt_number})" if receipt.receipt_number else ""),
                created_at=received_at,
            )
        )

    db.add_all(movements)
    db.commit()

    created = db.scalar(
        select(InventoryReceipt).where(InventoryReceipt.id == receipt.id).options(selectinload(InventoryReceipt.lines))
    )
    assert created is not None
    return created


@router.get("/issues", response_model=list[InventoryIssueRead])
def list_issues(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> list[InventoryIssue]:
    stmt = (
        select(InventoryIssue)
        .options(selectinload(InventoryIssue.lines))
        .order_by(InventoryIssue.issued_at.desc(), InventoryIssue.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return db.scalars(stmt).all()


@router.delete("/issues/{issue_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_issue(issue_id: int, db: Session = Depends(get_db)) -> None:
    issue = db.get(InventoryIssue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")

    moves = db.scalars(select(StockMovement).where(StockMovement.issue_id == issue_id)).all()
    delta_by_product: dict[int, int] = {}
    for movement in moves:
        delta_by_product[movement.product_id] = delta_by_product.get(movement.product_id, 0) + int(movement.quantity_delta)

    if delta_by_product:
        products = db.scalars(select(Product).where(Product.id.in_(set(delta_by_product.keys())))).all()
        product_by_id = {p.id: p for p in products}
        for product_id, delta in delta_by_product.items():
            product = product_by_id.get(product_id)
            if product is not None:
                product.quantity_on_hand -= delta

    for movement in moves:
        db.delete(movement)
    db.delete(issue)
    db.commit()


@router.post("/issues", response_model=InventoryIssueRead, status_code=status.HTTP_201_CREATED)
def create_issue(
    body: InventoryIssueCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InventoryIssue:
    return _create_issue(body=body, db=db, actor_username=current_user.username)


def _create_issue(*, body: InventoryIssueCreate, db: Session, actor_username: str | None = None) -> InventoryIssue:
    issued_at = body.issued_at or _utcnow()
    purpose = (body.purpose or "").strip() or "OTHER"
    issued_by = ((actor_username or "").strip() or (body.issued_by or "").strip()) or None
    issue_number = (body.issue_number or "").strip() or _generate_issue_number(db)

    issue = InventoryIssue(
        issue_number=issue_number,
        issued_at=issued_at,
        issued_by=issued_by,
        issued_to=(body.issued_to or "").strip() or None,
        purpose=purpose,
        note=body.note,
        sale_order_id=body.sale_order_id,
    )
    db.add(issue)
    db.flush()

    movements: list[StockMovement] = []
    for line_in in body.lines:
        product = db.get(Product, line_in.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail=f"Product {line_in.product_id} not found")
        if not product.is_active:
            raise HTTPException(status_code=400, detail=f"Product {product.id} is inactive")

        qty = int(line_in.quantity)
        unit = (getattr(line_in, "unit", None) or "SALE").upper()
        if unit not in {"BASE", "SALE"}:
            raise HTTPException(status_code=400, detail="Invalid unit (must be BASE or SALE)")
        multiplier = 1 if unit == "BASE" else int(product.uom_multiplier or 1)
        base_qty = qty * multiplier

        if product.quantity_on_hand < base_qty:
            raise HTTPException(status_code=400, detail=f"Not enough stock for product {product.sku}")

        iss_line = InventoryIssueLine(
            issue_id=issue.id,
            product_id=product.id,
            sku=product.sku,
            product_name=product.name,
            uom=(product.base_uom if unit == "BASE" else product.uom),
            uom_multiplier=multiplier,
            quantity=qty,
            note=line_in.note,
        )
        db.add(iss_line)
        db.flush()

        product.quantity_on_hand -= base_qty
        movements.append(
            StockMovement(
                product_id=product.id,
                issue_id=issue.id,
                issue_line_id=iss_line.id,
                sale_order_id=issue.sale_order_id,
                movement_type=StockMovementType.OUT,
                quantity_delta=-base_qty,
                note=f"Issue #{issue.id} [{purpose}]",
                created_at=issued_at,
            )
        )

    db.add_all(movements)
    db.commit()

    created = db.scalar(select(InventoryIssue).where(InventoryIssue.id == issue.id).options(selectinload(InventoryIssue.lines)))
    assert created is not None
    return created


@router.patch("/issues/{issue_id}", response_model=InventoryIssueRead)
def patch_issue(
    issue_id: int,
    body: InventoryIssueUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InventoryIssue:
    issue = db.scalar(select(InventoryIssue).where(InventoryIssue.id == issue_id).options(selectinload(InventoryIssue.lines)))
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")

    data = body.model_dump(exclude_unset=True)
    if "issue_number" in data:
        issue.issue_number = (data["issue_number"] or "").strip() or _generate_issue_number(db)
    if "issued_at" in data and data["issued_at"] is not None:
        issue.issued_at = data["issued_at"]
    if "issued_to" in data:
        issue.issued_to = (data["issued_to"] or "").strip() or None
    if "purpose" in data:
        issue.purpose = (data["purpose"] or "").strip() or "OTHER"
    if "note" in data:
        issue.note = (data["note"] or "").strip() or None
    issue.issued_by = (current_user.username or "").strip() or issue.issued_by

    if "lines" in data and data["lines"] is not None:
        moves = db.scalars(select(StockMovement).where(StockMovement.issue_id == issue.id)).all()
        rollback_by_product: dict[int, int] = {}
        for movement in moves:
            rollback_by_product[movement.product_id] = rollback_by_product.get(movement.product_id, 0) + int(movement.quantity_delta)

        if rollback_by_product:
            products = db.scalars(select(Product).where(Product.id.in_(set(rollback_by_product.keys())))).all()
            product_by_id = {p.id: p for p in products}
            for product_id, delta in rollback_by_product.items():
                product = product_by_id.get(product_id)
                if product is not None:
                    product.quantity_on_hand -= delta

        for movement in moves:
            db.delete(movement)
        for line in issue.lines:
            db.delete(line)
        db.flush()

        for line_in in data["lines"]:
            product = db.get(Product, line_in["product_id"])
            if product is None:
                raise HTTPException(status_code=404, detail=f"Product {line_in['product_id']} not found")
            if not product.is_active:
                raise HTTPException(status_code=400, detail=f"Product {product.id} is inactive")

            qty = int(line_in["quantity"])
            unit = (line_in.get("unit") or "SALE").upper()
            if unit not in {"BASE", "SALE"}:
                raise HTTPException(status_code=400, detail="Invalid unit (must be BASE or SALE)")
            multiplier = 1 if unit == "BASE" else int(product.uom_multiplier or 1)
            base_qty = qty * multiplier
            if product.quantity_on_hand < base_qty:
                raise HTTPException(status_code=400, detail=f"Not enough stock for product {product.sku}")

            issue_line = InventoryIssueLine(
                issue_id=issue.id,
                product_id=product.id,
                sku=product.sku,
                product_name=product.name,
                uom=(product.base_uom if unit == "BASE" else product.uom),
                uom_multiplier=multiplier,
                quantity=qty,
                note=line_in.get("note"),
            )
            db.add(issue_line)
            db.flush()

            product.quantity_on_hand -= base_qty
            db.add(
                StockMovement(
                    product_id=product.id,
                    issue_id=issue.id,
                    issue_line_id=issue_line.id,
                    sale_order_id=issue.sale_order_id,
                    movement_type=StockMovementType.OUT,
                    quantity_delta=-base_qty,
                    note=f"Issue #{issue.id} [{issue.purpose}]",
                    created_at=issue.issued_at,
                )
            )

    db.commit()
    updated = db.scalar(select(InventoryIssue).where(InventoryIssue.id == issue.id).options(selectinload(InventoryIssue.lines)))
    assert updated is not None
    return updated


@router.get("/receipts/template.xlsx")
def download_receipt_template() -> Response:
    try:
        xlsx = build_receipt_template_xlsx()
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e)) from e
    return Response(
        content=xlsx,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": 'attachment; filename="receipt-import-template.xlsx"'},
    )


@router.get("/issues/template.xlsx")
def download_issue_template() -> Response:
    try:
        xlsx = build_issue_template_xlsx()
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e)) from e
    return Response(
        content=xlsx,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": 'attachment; filename="issue-import-template.xlsx"'},
    )


if _has_python_multipart():

    @router.post("/receipts/import", response_model=InventoryReceiptRead, status_code=status.HTTP_201_CREATED)
    async def import_receipt_xlsx(
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> InventoryReceipt:
        content = await file.read()
        products = db.scalars(select(Product)).all()
        products_by_sku = {p.sku.strip().upper(): p for p in products if p.sku}
        try:
            payload = parse_receipt_import_xlsx(content, products_by_sku=products_by_sku)
        except ExcelImportError as e:
            raise HTTPException(status_code=400, detail="\n".join(e.errors)) from e
        except RuntimeError as e:
            raise HTTPException(status_code=501, detail=str(e)) from e

        # Validate product_id values that were specified directly.
        product_ids = {int(l["product_id"]) for l in payload["lines"]}
        existing_ids = {
            int(r[0])
            for r in db.execute(select(Product.id).where(Product.id.in_(product_ids))).all()
        }
        missing_ids = sorted(product_ids - existing_ids)
        if missing_ids:
            raise HTTPException(status_code=400, detail=f"Unknown product_id(s): {missing_ids}")

        body = InventoryReceiptCreate(
            receipt_number=payload.get("receipt_number"),
            received_at=payload.get("received_at"),
            received_by=payload.get("received_by"),
            note=payload.get("note"),
            lines=[
                {
                    "product_id": int(l["product_id"]),
                    "quantity": int(l["quantity"]),
                    "unit": str(l.get("unit") or "BASE"),
                    "unit_cost": Decimal(str(l.get("unit_cost") or 0)),
                    "note": l.get("note"),
                }
                for l in payload["lines"]
            ],
        )
        return _create_receipt(body=body, db=db, actor_username=current_user.username)


    @router.post("/issues/import", response_model=InventoryIssueRead, status_code=status.HTTP_201_CREATED)
    async def import_issue_xlsx(
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> InventoryIssue:
        content = await file.read()
        products = db.scalars(select(Product)).all()
        products_by_sku = {p.sku.strip().upper(): p for p in products if p.sku}
        try:
            payload = parse_issue_import_xlsx(content, products_by_sku=products_by_sku)
        except ExcelImportError as e:
            raise HTTPException(status_code=400, detail="\n".join(e.errors)) from e
        except RuntimeError as e:
            raise HTTPException(status_code=501, detail=str(e)) from e

        product_ids = {int(l["product_id"]) for l in payload["lines"]}
        existing_ids = {
            int(r[0])
            for r in db.execute(select(Product.id).where(Product.id.in_(product_ids))).all()
        }
        missing_ids = sorted(product_ids - existing_ids)
        if missing_ids:
            raise HTTPException(status_code=400, detail=f"Unknown product_id(s): {missing_ids}")

        body = InventoryIssueCreate(
            issue_number=payload.get("issue_number"),
            issued_at=payload.get("issued_at"),
            issued_by=payload.get("issued_by"),
            issued_to=payload.get("issued_to"),
            purpose=payload.get("purpose") or "OTHER",
            note=payload.get("note"),
            lines=[
                {
                    "product_id": int(l["product_id"]),
                    "quantity": int(l["quantity"]),
                    "unit": str(l.get("unit") or "BASE"),
                    "note": l.get("note"),
                }
                for l in payload["lines"]
            ],
        )
        return _create_issue(body=body, db=db, actor_username=current_user.username)
else:

    @router.post("/receipts/import", status_code=status.HTTP_501_NOT_IMPLEMENTED)
    async def import_receipt_xlsx_unavailable() -> None:
        raise HTTPException(
            status_code=501,
            detail='Missing dependency: python-multipart. Install with "pip install python-multipart".',
        )


    @router.post("/issues/import", status_code=status.HTTP_501_NOT_IMPLEMENTED)
    async def import_issue_xlsx_unavailable() -> None:
        raise HTTPException(
            status_code=501,
            detail='Missing dependency: python-multipart. Install with "pip install python-multipart".',
        )


def _export_rows_to_xlsx(headers: list[str], rows: list[list[object]], *, sheet_name: str) -> bytes:
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font
    except Exception as e:  # pragma: no cover
        raise RuntimeError("Missing dependency: openpyxl. Please `pip install openpyxl`.") from e
    from io import BytesIO

    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for r in rows:
        ws.append(r)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.get("/receipts/export.xlsx")
def export_receipts(limit: int = 50, db: Session = Depends(get_db)) -> Response:
    stmt = (
        select(InventoryReceipt)
        .options(selectinload(InventoryReceipt.lines))
        .order_by(InventoryReceipt.received_at.desc(), InventoryReceipt.id.desc())
        .limit(limit)
    )
    receipts = db.scalars(stmt).all()
    product_ids = {l.product_id for r in receipts for l in r.lines}
    products = db.scalars(select(Product).where(Product.id.in_(product_ids))).all() if product_ids else []
    product_by_id = {p.id: p for p in products}

    headers = [
        "receipt_id",
        "receipt_number",
        "received_at",
        "received_by",
        "note",
        "sku",
        "product_id",
        "quantity",
        "unit",
        "unit_cost",
        "currency",
        "line_note",
    ]
    rows: list[list[object]] = []
    for r in receipts:
        for l in r.lines:
            p = product_by_id.get(l.product_id)
            unit = "SALE"
            if p is not None and l.uom_multiplier == 1 and (l.uom or "").strip().lower() == (p.base_uom or "Pc").strip().lower():
                unit = "BASE"
            rows.append(
                [
                    r.id,
                    r.receipt_number or "",
                    r.received_at,
                    r.received_by or "",
                    r.note or "",
                    l.sku,
                    l.product_id,
                    l.quantity,
                    unit,
                    float(l.unit_cost),
                    l.currency,
                    l.note or "",
                ]
            )
    try:
        xlsx = _export_rows_to_xlsx(headers, rows, sheet_name="Receipts")
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e)) from e
    return Response(
        content=xlsx,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": 'attachment; filename="receipts-export.xlsx"'},
    )


@router.get("/issues/export.xlsx")
def export_issues(limit: int = 50, db: Session = Depends(get_db)) -> Response:
    stmt = (
        select(InventoryIssue)
        .options(selectinload(InventoryIssue.lines))
        .order_by(InventoryIssue.issued_at.desc(), InventoryIssue.id.desc())
        .limit(limit)
    )
    issues = db.scalars(stmt).all()
    product_ids = {l.product_id for r in issues for l in r.lines}
    products = db.scalars(select(Product).where(Product.id.in_(product_ids))).all() if product_ids else []
    product_by_id = {p.id: p for p in products}

    headers = [
        "issue_id",
        "issue_number",
        "issued_at",
        "issued_by",
        "issued_to",
        "purpose",
        "note",
        "sku",
        "product_id",
        "quantity",
        "unit",
        "line_note",
    ]
    rows: list[list[object]] = []
    for r in issues:
        for l in r.lines:
            p = product_by_id.get(l.product_id)
            unit = "SALE"
            if p is not None and l.uom_multiplier == 1 and (l.uom or "").strip().lower() == (p.base_uom or "Pc").strip().lower():
                unit = "BASE"
            rows.append(
                [
                    r.id,
                    r.issue_number or "",
                    r.issued_at,
                    r.issued_by or "",
                    r.issued_to or "",
                    r.purpose,
                    r.note or "",
                    l.sku,
                    l.product_id,
                    l.quantity,
                    unit,
                    l.note or "",
                ]
            )
    try:
        xlsx = _export_rows_to_xlsx(headers, rows, sheet_name="Issues")
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e)) from e
    return Response(
        content=xlsx,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": 'attachment; filename="issues-export.xlsx"'},
    )


@router.get("/receipts/{receipt_id}", response_model=InventoryReceiptRead)
def get_receipt(receipt_id: int, db: Session = Depends(get_db)) -> InventoryReceipt:
    stmt = select(InventoryReceipt).where(InventoryReceipt.id == receipt_id).options(selectinload(InventoryReceipt.lines))
    receipt = db.scalar(stmt)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return receipt


@router.get("/issues/{issue_id}", response_model=InventoryIssueRead)
def get_issue(issue_id: int, db: Session = Depends(get_db)) -> InventoryIssue:
    stmt = select(InventoryIssue).where(InventoryIssue.id == issue_id).options(selectinload(InventoryIssue.lines))
    issue = db.scalar(stmt)
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue
