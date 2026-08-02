from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db
from app.db.models import AmazonBoxCapacity, AmazonBoxType, AmazonProductMapping, Product
from app.schemas.amazon_shipment import (
    AmazonBoxTypeRead,
    AmazonBoxTypeUpsert,
    AmazonCapacityRead,
    AmazonCapacityUpsert,
    AmazonCsvExportRequest,
    AmazonCsvImportRead,
    AmazonImportedBoxRead,
    AmazonImportedItemRead,
    AmazonMappingRead,
    AmazonMappingUpsert,
    AmazonOptimizePlanRead,
    AmazonOptimizeRequest,
    AmazonOptimizeResponse,
    AmazonShipmentConfigRead,
    AmazonWebProductRead,
)
from app.services.amazon_shipment import (
    SolverBoxType,
    SolverSku,
    optimize_identical_cartons,
    parse_amazon_pack_csv,
    render_amazon_pack_csv,
)


router = APIRouter(prefix="/amazon-shipments")
MAX_CSV_BYTES = 5 * 1024 * 1024


def _mapping_read(mapping: AmazonProductMapping) -> AmazonMappingRead:
    product = mapping.product
    return AmazonMappingRead(
        id=mapping.id,
        amazon_sku=mapping.amazon_sku,
        product_id=mapping.product_id,
        product_sku=product.sku if product else None,
        product_name=product.name if product else None,
        quantity_on_hand=int(product.quantity_on_hand) if product else None,
        asin=mapping.asin,
        fnsku=mapping.fnsku,
        title=mapping.title,
        unit_weight_lb=float(mapping.unit_weight_lb) if mapping.unit_weight_lb is not None else None,
    )


def _box_type_read(box_type: AmazonBoxType) -> AmazonBoxTypeRead:
    capacities = sorted(box_type.capacities, key=lambda value: value.mapping.amazon_sku.casefold())
    return AmazonBoxTypeRead(
        id=box_type.id,
        name=box_type.name,
        length_in=float(box_type.length_in),
        width_in=float(box_type.width_in),
        height_in=float(box_type.height_in),
        empty_weight_lb=float(box_type.empty_weight_lb),
        max_weight_lb=float(box_type.max_weight_lb) if box_type.max_weight_lb is not None else None,
        is_active=bool(box_type.is_active),
        capacities=[
            AmazonCapacityRead(
                id=capacity.id,
                mapping_id=capacity.mapping_id,
                amazon_sku=capacity.mapping.amazon_sku,
                units_capacity=capacity.units_capacity,
            )
            for capacity in capacities
        ],
    )


def _load_mapping(db: Session, mapping_id: int) -> AmazonProductMapping:
    mapping = db.scalar(
        select(AmazonProductMapping)
        .options(selectinload(AmazonProductMapping.product))
        .where(AmazonProductMapping.id == mapping_id)
    )
    if mapping is None:
        raise HTTPException(status_code=404, detail="Amazon SKU mapping not found")
    return mapping


def _load_box_type(db: Session, box_type_id: int) -> AmazonBoxType:
    box_type = db.scalar(
        select(AmazonBoxType)
        .options(
            selectinload(AmazonBoxType.capacities).selectinload(AmazonBoxCapacity.mapping)
        )
        .where(AmazonBoxType.id == box_type_id)
    )
    if box_type is None:
        raise HTTPException(status_code=404, detail="Box type not found")
    return box_type


@router.get("/config", response_model=AmazonShipmentConfigRead)
def get_config(db: Session = Depends(get_db)) -> AmazonShipmentConfigRead:
    products = db.scalars(select(Product).order_by(Product.sku.asc())).all()
    mappings = db.scalars(
        select(AmazonProductMapping)
        .options(selectinload(AmazonProductMapping.product))
        .order_by(AmazonProductMapping.amazon_sku.asc())
    ).all()
    box_types = db.scalars(
        select(AmazonBoxType)
        .options(
            selectinload(AmazonBoxType.capacities).selectinload(AmazonBoxCapacity.mapping)
        )
        .order_by(AmazonBoxType.name.asc())
    ).all()
    return AmazonShipmentConfigRead(
        products=[
            AmazonWebProductRead(
                id=product.id,
                sku=product.sku,
                name=product.name,
                quantity_on_hand=int(product.quantity_on_hand),
            )
            for product in products
        ],
        mappings=[_mapping_read(mapping) for mapping in mappings],
        box_types=[_box_type_read(box_type) for box_type in box_types],
    )


@router.post("/mappings", response_model=AmazonMappingRead)
def upsert_mapping(
    payload: AmazonMappingUpsert,
    db: Session = Depends(get_db),
) -> AmazonMappingRead:
    amazon_sku = payload.amazon_sku.strip()
    product = None
    if payload.product_id is not None:
        product = db.get(Product, payload.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Web product not found")
    mapping = db.scalar(
        select(AmazonProductMapping).where(AmazonProductMapping.amazon_sku == amazon_sku)
    )
    if mapping is None:
        mapping = AmazonProductMapping(amazon_sku=amazon_sku)
        db.add(mapping)
    mapping.product_id = product.id if product else None
    mapping.asin = (payload.asin or "").strip() or None
    mapping.fnsku = (payload.fnsku or "").strip() or None
    mapping.title = (payload.title or "").strip() or None
    mapping.unit_weight_lb = payload.unit_weight_lb
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Amazon SKU mapping already exists") from exc
    mapping = _load_mapping(db, mapping.id)
    return _mapping_read(mapping)


@router.post("/box-types", response_model=AmazonBoxTypeRead, status_code=status.HTTP_201_CREATED)
def create_box_type(
    payload: AmazonBoxTypeUpsert,
    db: Session = Depends(get_db),
) -> AmazonBoxTypeRead:
    box_type = AmazonBoxType(
        name=payload.name.strip(),
        length_in=payload.length_in,
        width_in=payload.width_in,
        height_in=payload.height_in,
        empty_weight_lb=payload.empty_weight_lb,
        max_weight_lb=payload.max_weight_lb,
        is_active=payload.is_active,
    )
    db.add(box_type)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A box type with this name already exists") from exc
    return _box_type_read(_load_box_type(db, box_type.id))


@router.put("/box-types/{box_type_id}", response_model=AmazonBoxTypeRead)
def update_box_type(
    box_type_id: int,
    payload: AmazonBoxTypeUpsert,
    db: Session = Depends(get_db),
) -> AmazonBoxTypeRead:
    box_type = _load_box_type(db, box_type_id)
    box_type.name = payload.name.strip()
    box_type.length_in = payload.length_in
    box_type.width_in = payload.width_in
    box_type.height_in = payload.height_in
    box_type.empty_weight_lb = payload.empty_weight_lb
    box_type.max_weight_lb = payload.max_weight_lb
    box_type.is_active = payload.is_active
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A box type with this name already exists") from exc
    return _box_type_read(_load_box_type(db, box_type.id))


@router.delete("/box-types/{box_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_box_type(box_type_id: int, db: Session = Depends(get_db)) -> Response:
    box_type = _load_box_type(db, box_type_id)
    db.delete(box_type)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/capacities", response_model=AmazonCapacityRead)
def upsert_capacity(
    payload: AmazonCapacityUpsert,
    db: Session = Depends(get_db),
) -> AmazonCapacityRead:
    mapping = _load_mapping(db, payload.mapping_id)
    box_type = _load_box_type(db, payload.box_type_id)
    capacity = db.scalar(
        select(AmazonBoxCapacity).where(
            AmazonBoxCapacity.box_type_id == box_type.id,
            AmazonBoxCapacity.mapping_id == mapping.id,
        )
    )
    if capacity is None:
        capacity = AmazonBoxCapacity(
            box_type_id=box_type.id,
            mapping_id=mapping.id,
            units_capacity=payload.units_capacity,
        )
        db.add(capacity)
    else:
        capacity.units_capacity = payload.units_capacity
    db.commit()
    db.refresh(capacity)
    return AmazonCapacityRead(
        id=capacity.id,
        mapping_id=mapping.id,
        amazon_sku=mapping.amazon_sku,
        units_capacity=capacity.units_capacity,
    )


@router.post("/import", response_model=AmazonCsvImportRead)
async def import_amazon_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> AmazonCsvImportRead:
    filename = (file.filename or "").lower()
    if not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload the CSV downloaded from Amazon")
    content = await file.read(MAX_CSV_BYTES + 1)
    if len(content) > MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail="Amazon CSV must be 5 MB or smaller")
    try:
        parsed = parse_amazon_pack_csv(content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    skus = [item.amazon_sku for item in parsed.item_rows]
    mappings = db.scalars(
        select(AmazonProductMapping)
        .options(selectinload(AmazonProductMapping.product))
        .where(AmazonProductMapping.amazon_sku.in_(skus))
    ).all()
    mapping_by_sku = {mapping.amazon_sku: mapping for mapping in mappings}
    return AmazonCsvImportRead(
        pack_group_number=parsed.pack_group_number,
        workflow_name=parsed.workflow_name,
        declared_sku_count=parsed.declared_sku_count,
        declared_unit_count=parsed.declared_unit_count,
        existing_box_count=len(parsed.boxes),
        items=[
            AmazonImportedItemRead(
                amazon_sku=item.amazon_sku,
                title=item.title,
                asin=item.asin,
                fnsku=item.fnsku,
                requested_quantity=item.requested_quantity,
                mapping=(
                    _mapping_read(mapping_by_sku[item.amazon_sku])
                    if item.amazon_sku in mapping_by_sku
                    else None
                ),
            )
            for item in parsed.item_rows
        ],
        boxes=[
            AmazonImportedBoxRead(
                number=box.number,
                name=box.name,
                weight_lb=box.weight_lb,
                length_in=box.length_in,
                width_in=box.width_in,
                height_in=box.height_in,
            )
            for box in parsed.boxes
        ],
        warnings=list(parsed.warnings),
    )


@router.post("/optimize", response_model=AmazonOptimizeResponse)
def optimize_shipment(
    payload: AmazonOptimizeRequest,
    db: Session = Depends(get_db),
) -> AmazonOptimizeResponse:
    input_by_sku = {item.amazon_sku.strip(): item for item in payload.items}
    if len(input_by_sku) != len(payload.items):
        raise HTTPException(status_code=400, detail="Amazon SKUs must be unique")
    mappings = db.scalars(
        select(AmazonProductMapping)
        .options(selectinload(AmazonProductMapping.capacities))
        .where(AmazonProductMapping.amazon_sku.in_(input_by_sku))
    ).all()
    mapping_by_sku = {mapping.amazon_sku: mapping for mapping in mappings}
    missing_mappings = sorted(set(input_by_sku) - set(mapping_by_sku))
    if missing_mappings:
        raise HTTPException(
            status_code=400,
            detail="Map these Amazon SKUs to web products first: " + ", ".join(missing_mappings),
        )

    box_types = db.scalars(
        select(AmazonBoxType)
        .options(
            selectinload(AmazonBoxType.capacities).selectinload(AmazonBoxCapacity.mapping)
        )
        .where(AmazonBoxType.id.in_(payload.box_type_ids))
    ).all()
    if len(box_types) != len(set(payload.box_type_ids)):
        raise HTTPException(status_code=400, detail="One or more selected box types no longer exist")

    missing_profiles_by_box: dict[int, list[str]] = {box_type.id: [] for box_type in box_types}
    solver_skus: list[SolverSku] = []
    for amazon_sku, item in input_by_sku.items():
        mapping = mapping_by_sku[amazon_sku]
        capacity_by_box = {
            capacity.box_type_id: capacity.units_capacity
            for capacity in mapping.capacities
            if capacity.box_type_id in payload.box_type_ids
        }
        for box_type in box_types:
            if box_type.id not in capacity_by_box:
                missing_profiles_by_box[box_type.id].append(amazon_sku)
        solver_skus.append(
            SolverSku(
                amazon_sku=amazon_sku,
                title=mapping.title,
                requested_quantity=item.requested_quantity,
                available_quantity=item.available_quantity,
                unit_weight_lb=(
                    float(mapping.unit_weight_lb) if mapping.unit_weight_lb is not None else None
                ),
                capacities=capacity_by_box,
            )
        )
    complete_box_type_ids = {
        box_type.id
        for box_type in box_types
        if not missing_profiles_by_box[box_type.id]
    }
    if not complete_box_type_ids:
        missing_profiles = [
            f"{amazon_sku} × {box_type.name}"
            for box_type in box_types
            for amazon_sku in missing_profiles_by_box[box_type.id]
        ]
        raise HTTPException(
            status_code=400,
            detail="Enter units-per-box capacity for: " + "; ".join(missing_profiles),
        )

    plans = optimize_identical_cartons(
        skus=solver_skus,
        box_types=[
            SolverBoxType(
                id=box_type.id,
                name=box_type.name,
                length_in=float(box_type.length_in),
                width_in=float(box_type.width_in),
                height_in=float(box_type.height_in),
                empty_weight_lb=float(box_type.empty_weight_lb),
                max_weight_lb=(
                    float(box_type.max_weight_lb) if box_type.max_weight_lb is not None else None
                ),
            )
            for box_type in box_types
            if box_type.id in complete_box_type_ids
        ],
        min_box_count=payload.min_box_count,
        max_box_count=payload.max_box_count,
    )
    warnings = [
        f"Ignored box type {box_type.name} because capacity is missing for: "
        + ", ".join(missing_profiles_by_box[box_type.id])
        for box_type in box_types
        if missing_profiles_by_box[box_type.id]
    ]
    if not plans:
        warnings.append(
            "No identical-carton plan fits the selected box profiles and available quantities."
        )
    return AmazonOptimizeResponse(
        plans=[AmazonOptimizePlanRead.model_validate(plan) for plan in plans],
        warnings=warnings,
    )


@router.post("/export")
def export_amazon_csv(payload: AmazonCsvExportRequest) -> Response:
    try:
        output = render_amazon_pack_csv(
            payload.source_csv,
            per_box_quantities={
                item.amazon_sku: item.per_box_quantity for item in payload.items
            },
            boxes=[
                {
                    "name": box.name,
                    "weight_lb": box.weight_lb,
                    "length_in": box.length_in,
                    "width_in": box.width_in,
                    "height_in": box.height_in,
                }
                for box in payload.boxes
            ],
        )
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=output,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="amazon-optimized-box-packing.csv"'
        },
    )
