from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db
from app.db.models import (
    GroceryInboundBatch,
    GroceryInboundItem,
    GroceryRepackLog,
    Product,
    StockMovement,
    StockMovementType,
)
from app.schemas.grocery import (
    GroceryInboundBatchCreate,
    GroceryInboundBatchDetail,
    GroceryInboundBatchRead,
    GroceryInboundItemCreate,
    GroceryInboundItemRead,
    GroceryRepackLogCreate,
    GroceryRepackLogRead,
)

router = APIRouter(prefix="/grocery", tags=["grocery"])


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_batch_read(b: GroceryInboundBatch) -> GroceryInboundBatchRead:
    items = b.items or []
    tot_init = sum(Decimal(str(it.initial_quantity or 0)) for it in items)
    tot_rep = sum(Decimal(str(it.repacked_quantity or 0)) for it in items)
    tot_rem = sum(Decimal(str(it.remaining_quantity or 0)) for it in items)
    return GroceryInboundBatchRead(
        id=b.id,
        batch_code=b.batch_code,
        received_at=b.received_at,
        supplier=b.supplier,
        notes=b.notes,
        status=b.status,
        item_count=len(items),
        total_initial_qty=tot_init,
        total_repacked_qty=tot_rep,
        total_remaining_qty=tot_rem,
        created_at=b.created_at,
        updated_at=b.updated_at,
    )


def _to_repack_read(r: GroceryRepackLog) -> GroceryRepackLogRead:
    return GroceryRepackLogRead(
        id=r.id,
        batch_id=r.batch_id,
        batch_code=r.batch.batch_code if r.batch else "",
        inbound_item_id=r.inbound_item_id,
        inbound_item_name=r.inbound_item.item_name if r.inbound_item else "",
        inbound_item_uom=r.inbound_item.uom if r.inbound_item else "kg",
        target_product_id=r.target_product_id,
        target_product_name=r.target_product.name if r.target_product else "",
        target_product_sku=r.target_product.sku if r.target_product else "",
        source_qty_used=r.source_qty_used,
        target_units_produced=r.target_units_produced,
        yield_per_unit=r.yield_per_unit,
        repacked_at=r.repacked_at,
        note=r.note,
        created_at=r.created_at,
    )


# =============================================================================
# INBOUND BATCHES (ĐỢT NHẬP HÀNG XÁ)
# =============================================================================

@router.get("/batches", response_model=list[GroceryInboundBatchRead])
def list_inbound_batches(db: Session = Depends(get_db)):
    """Danh sách các đợt nhập hàng xá (mới nhất lên đầu)."""
    q = select(GroceryInboundBatch).order_by(GroceryInboundBatch.received_at.desc())
    batches = db.execute(q).scalars().all()
    return [_to_batch_read(b) for b in batches]


@router.get("/batches/latest", response_model=Optional[GroceryInboundBatchDetail])
def get_latest_batch(db: Session = Depends(get_db)):
    """Lấy chi tiết đợt nhập mới nhất để đối chiếu ngay trên màn hình."""
    q = (
        select(GroceryInboundBatch)
        .order_by(GroceryInboundBatch.received_at.desc())
        .limit(1)
    )
    b = db.execute(q).scalar_one_or_none()
    if not b:
        return None
    return _build_batch_detail(b, db)


@router.get("/batches/{batch_id}", response_model=GroceryInboundBatchDetail)
def get_batch_detail(batch_id: int, db: Session = Depends(get_db)):
    """Lấy toàn bộ chi tiết của một đợt nhập hàng (gồm items và nhật ký đóng hũ)."""
    b = db.get(GroceryInboundBatch, batch_id)
    if not b:
        raise HTTPException(status_code=404, detail="Không tìm thấy đợt nhập hàng.")
    return _build_batch_detail(b, db)


def _build_batch_detail(b: GroceryInboundBatch, db: Session) -> GroceryInboundBatchDetail:
    items = b.items or []
    tot_init = sum(Decimal(str(it.initial_quantity or 0)) for it in items)
    tot_rep = sum(Decimal(str(it.repacked_quantity or 0)) for it in items)
    tot_rem = sum(Decimal(str(it.remaining_quantity or 0)) for it in items)
    items_read = [GroceryInboundItemRead.model_validate(it) for it in items]
    logs_read = [_to_repack_read(r) for r in b.repack_logs]
    return GroceryInboundBatchDetail(
        id=b.id,
        batch_code=b.batch_code,
        received_at=b.received_at,
        supplier=b.supplier,
        notes=b.notes,
        status=b.status,
        item_count=len(items),
        total_initial_qty=tot_init,
        total_repacked_qty=tot_rep,
        total_remaining_qty=tot_rem,
        created_at=b.created_at,
        updated_at=b.updated_at,
        items=items_read,
        repack_logs=logs_read,
    )


@router.post("/batches", response_model=GroceryInboundBatchDetail, status_code=status.HTTP_201_CREATED)
def create_inbound_batch(body: GroceryInboundBatchCreate, db: Session = Depends(get_db)):
    """Tạo đợt nhập hàng xá mới kèm danh sách các mặt hàng xá nhập về."""
    now = utcnow()
    batch_code = body.batch_code.strip() if body.batch_code else f"LO-{now.strftime('%Y%m%d-%H%M')}"

    # Check duplicate batch_code
    existing = db.execute(
        select(GroceryInboundBatch).where(GroceryInboundBatch.batch_code == batch_code)
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"Mã đợt '{batch_code}' đã tồn tại.")

    batch = GroceryInboundBatch(
        batch_code=batch_code,
        received_at=body.received_at or now,
        supplier=body.supplier,
        notes=body.notes,
        status="OPEN",
    )
    db.add(batch)
    db.flush()

    for it in body.items:
        init_qty = Decimal(str(it.initial_quantity or 0))
        item = GroceryInboundItem(
            batch_id=batch.id,
            product_id=it.product_id,
            item_name=it.item_name.strip(),
            sku=it.sku.strip(),
            uom=it.uom.strip() or "kg",
            initial_quantity=init_qty,
            repacked_quantity=Decimal("0"),
            remaining_quantity=init_qty,
            cost_price=it.cost_price,
            notes=it.notes,
        )
        db.add(item)

    db.commit()
    db.refresh(batch)
    return _build_batch_detail(batch, db)


@router.post("/batches/{batch_id}/items", response_model=GroceryInboundItemRead, status_code=status.HTTP_201_CREATED)
def add_item_to_batch(batch_id: int, it: GroceryInboundItemCreate, db: Session = Depends(get_db)):
    """Thêm một mặt hàng xá vào đợt nhập đã có."""
    batch = db.get(GroceryInboundBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Không tìm thấy đợt nhập hàng.")

    init_qty = Decimal(str(it.initial_quantity or 0))
    item = GroceryInboundItem(
        batch_id=batch.id,
        product_id=it.product_id,
        item_name=it.item_name.strip(),
        sku=it.sku.strip(),
        uom=it.uom.strip() or "kg",
        initial_quantity=init_qty,
        repacked_quantity=Decimal("0"),
        remaining_quantity=init_qty,
        cost_price=it.cost_price,
        notes=it.notes,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return GroceryInboundItemRead.model_validate(item)


# =============================================================================
# REPACK (NHẬT KÝ ĐÓNG HŨ & ĐỐI CHIẾU)
# =============================================================================

@router.post("/repack", response_model=GroceryRepackLogRead, status_code=status.HTTP_201_CREATED)
def record_repack(body: GroceryRepackLogCreate, db: Session = Depends(get_db)):
    """
    Ghi nhận một lần đóng hũ / chia nhỏ:
    - Trừ số xá còn lại trong đợt (remaining_quantity -= source_qty_used)
    - Tăng số xá đã chia (repacked_quantity += source_qty_used)
    - Tăng tồn kho sản phẩm hũ (target_product.quantity_on_hand += target_units_produced)
    - Tạo StockMovement IN cho hũ
    - Lưu nhật ký đóng hũ
    """
    inbound_item = db.get(GroceryInboundItem, body.inbound_item_id)
    if not inbound_item:
        raise HTTPException(status_code=404, detail="Không tìm thấy mặt hàng xá trong đợt nhập.")

    target_product = db.get(Product, body.target_product_id)
    if not target_product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm hũ thành phẩm.")

    if body.source_qty_used <= Decimal("0"):
        raise HTTPException(status_code=400, detail="Số lượng xá sử dụng phải > 0.")
    if body.target_units_produced <= 0:
        raise HTTPException(status_code=400, detail="Số hũ sản xuất được phải > 0.")

    if inbound_item.remaining_quantity < body.source_qty_used:
        raise HTTPException(
            status_code=400,
            detail=f"Số lượng xá trong đợt không đủ: hiện còn {inbound_item.remaining_quantity} {inbound_item.uom}, yêu cầu {body.source_qty_used} {inbound_item.uom}.",
        )

    # Tính yield (tỷ lệ kg xá cho mỗi hũ)
    yield_val = body.source_qty_used / Decimal(str(body.target_units_produced))
    repacked_time = body.repacked_at or utcnow()

    # 1. Tạo bản ghi nhật ký
    log = GroceryRepackLog(
        batch_id=inbound_item.batch_id,
        inbound_item_id=inbound_item.id,
        target_product_id=target_product.id,
        source_qty_used=body.source_qty_used,
        target_units_produced=body.target_units_produced,
        yield_per_unit=yield_val,
        repacked_at=repacked_time,
        note=body.note,
    )
    db.add(log)
    db.flush()

    # 2. Tạo StockMovement IN cho sản phẩm hũ
    mv = StockMovement(
        product_id=target_product.id,
        movement_type=StockMovementType.IN,
        quantity_delta=body.target_units_produced,
        note=f"Đóng hũ từ {inbound_item.item_name} ({body.source_qty_used} {inbound_item.uom}) — Đợt {inbound_item.batch.batch_code}",
    )
    db.add(mv)
    db.flush()
    log.stock_movement_id = mv.id

    # 3. Cập nhật đối chiếu của đợt nhập
    inbound_item.repacked_quantity += body.source_qty_used
    inbound_item.remaining_quantity -= body.source_qty_used

    # 4. Cập nhật tồn kho sản phẩm hũ
    target_product.quantity_on_hand += body.target_units_produced

    db.commit()
    db.refresh(log)
    return _to_repack_read(log)


@router.delete("/repack/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def rollback_repack(log_id: int, db: Session = Depends(get_db)):
    """Huỷ một lần đóng hũ (rollback đối chiếu và tồn kho)."""
    log = db.get(GroceryRepackLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhật ký đóng hũ.")

    inbound_item = db.get(GroceryInboundItem, log.inbound_item_id)
    target_product = db.get(Product, log.target_product_id)

    # Rollback đợt nhập
    if inbound_item:
        inbound_item.repacked_quantity = max(Decimal("0"), inbound_item.repacked_quantity - log.source_qty_used)
        inbound_item.remaining_quantity += log.source_qty_used

    # Rollback tồn sản phẩm hũ
    if target_product:
        target_product.quantity_on_hand = max(0, target_product.quantity_on_hand - log.target_units_produced)

    # Xoá StockMovement
    if log.stock_movement_id:
        mv = db.get(StockMovement, log.stock_movement_id)
        if mv:
            db.delete(mv)

    db.delete(log)
    db.commit()


@router.get("/repack-logs", response_model=list[GroceryRepackLogRead])
def list_repack_logs(batch_id: Optional[int] = None, limit: int = 200, db: Session = Depends(get_db)):
    """Danh sách toàn bộ nhật ký đóng hũ (mới nhất lên đầu)."""
    q = select(GroceryRepackLog).order_by(GroceryRepackLog.repacked_at.desc()).limit(limit)
    if batch_id:
        q = q.where(GroceryRepackLog.batch_id == batch_id)
    logs = db.execute(q).scalars().all()
    return [_to_repack_read(r) for r in logs]
