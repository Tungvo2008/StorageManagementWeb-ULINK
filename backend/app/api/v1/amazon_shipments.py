from __future__ import annotations
import os

import base64
import binascii
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db
from app.api.v1.inventory import _create_issue
from app.db.models import AmazonBoxCapacity, AmazonBoxType, AmazonProductMapping, InventoryIssue, Product
from app.schemas.inventory import InventoryIssueCreate, InventoryIssueLineCreate, InventoryIssueRead
from app.schemas.amazon_shipment import (
    CreateFbaInboundLineInput,
    CreateFbaInboundShipmentRequest,
    CreateFbaInboundShipmentResponse,

    AmazonBoxTypeRead,
    AmazonBoxTypeUpsert,
    AmazonCapacityRead,
    AmazonCapacityUpsert,
    AmazonCsvExportRequest,
    AmazonCsvImportRead,
    AmazonFbaDispatchLine,
    AmazonFbaDispatchRequest,
    AmazonFbaDispatchResponse,
    AmazonImportedBoxRead,
    AmazonImportedItemRead,
    AmazonMappingRead,
    AmazonMappingUpsert,
    AmazonManifestExportRequest,
    AmazonPackXlsxExportRequest,
    AmazonOptimizePlanRead,
    AmazonOptimizeRequest,
    AmazonOptimizeResponse,
    AmazonShipmentConfigRead,
    AmazonWebProductRead,
    AmazonFbaInventorySummary,
    AmazonFbaItemStock,
    AmazonRestockSuggestionResponse,
    AmazonRestockSuggestionItem,
    AmazonRestockSuggestRequest,
    AmazonShipmentProductTotal,
    AmazonShipmentBatchItem,
    AmazonShipmentBatch,
    AmazonShipmentsHubResponse,
    AmazonFbmItem,
    AmazonFbmOrder,
    AmazonFbmOrdersResponse,

)
from app.services.amazon_shipment import (
    SolverBoxType,
    SolverSku,
    optimize_identical_cartons,
    parse_amazon_pack_csv,
    render_amazon_manifest_xlsx,
    render_amazon_pack_xlsx,
    render_amazon_pack_csv,
)


router = APIRouter(prefix="/amazon-shipments")
AMAZON_SHIPPING_BASE_URL = os.getenv("AMAZON_SHIPPING_URL", "http://amazon-shipping-amazon-shipping-1:5688")
MAX_CSV_BYTES = 5 * 1024 * 1024
AMAZON_MANIFEST_TEMPLATE_PATH = (
    Path(__file__).resolve().parents[3]
    / "assets"
    / "amazon"
    / "ManifestFileUpload_Template_MPL.xlsx"
)


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
                image_url=product.image_url,
                quantity_on_hand=int(product.quantity_on_hand),
                is_sold_on_amazon=bool(product.is_sold_on_amazon),
                amazon_sku=product.amazon_sku,
                business_unit=product.business_unit or "TOWEL",
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
    if not amazon_sku:
        raise HTTPException(status_code=400, detail="Amazon SKU is required")
    product = None
    if payload.product_id is not None:
        product = db.get(Product, payload.product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Web product not found")
        if len(amazon_sku) > 80 or not amazon_sku.isascii():
            raise HTTPException(
                status_code=400,
                detail="Amazon SKU assigned to a product must be 80 or fewer ASCII characters",
            )
        assigned_product = db.scalar(
            select(Product).where(
                Product.amazon_sku == amazon_sku,
                Product.id != product.id,
            )
        )
        if assigned_product is not None:
            raise HTTPException(
                status_code=409,
                detail="Amazon SKU is already assigned to another product",
            )
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
    if product is not None:
        product.is_sold_on_amazon = True
        product.amazon_sku = amazon_sku
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


@router.post("/packing-template/export")
def export_amazon_pack_xlsx(payload: AmazonPackXlsxExportRequest) -> Response:
    try:
        source = base64.b64decode(payload.source_xlsx_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid Amazon XLSX payload") from exc
    if len(source) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Amazon XLSX must be 10 MB or smaller")
    try:
        output = render_amazon_pack_xlsx(
            source,
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
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="amazon-box-packing-information-filled.xlsx"'
        },
    )


@router.post("/manifest/export")
def export_amazon_manifest(
    payload: AmazonManifestExportRequest,
    db: Session = Depends(get_db),
) -> Response:
    product_ids = [item.product_id for item in payload.items]
    if len(set(product_ids)) != len(product_ids):
        raise HTTPException(status_code=400, detail="Each product can only be selected once")
    products = db.scalars(select(Product).where(Product.id.in_(product_ids))).all()
    product_by_id = {product.id: product for product in products}
    missing_ids = sorted(set(product_ids) - set(product_by_id))
    if missing_ids:
        raise HTTPException(
            status_code=404,
            detail="Products not found: " + ", ".join(str(value) for value in missing_ids),
        )

    manifest_items: list[tuple[str, int]] = []
    for item in payload.items:
        product = product_by_id[item.product_id]
        if not product.is_sold_on_amazon or not product.amazon_sku:
            raise HTTPException(
                status_code=400,
                detail=f"Product {product.sku} is not configured for Amazon",
            )
        manifest_items.append((product.amazon_sku, item.quantity))

    try:
        source = AMAZON_MANIFEST_TEMPLATE_PATH.read_bytes()
        output = render_amazon_manifest_xlsx(source, items=manifest_items)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="Amazon manifest template is missing") from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="amazon-create-workflow-manifest.xlsx"'
        },
    )


@router.post("/fba-dispatch", response_model=AmazonFbaDispatchResponse, status_code=status.HTTP_201_CREATED)
def dispatch_amazon_fba(
    payload: AmazonFbaDispatchRequest,
    db: Session = Depends(get_db),
) -> AmazonFbaDispatchResponse:
    if not payload.lines:
        raise HTTPException(status_code=400, detail="Dispatch requires at least one product line")

    issue_lines_input: list[InventoryIssueLineCreate] = []
    before_qty_map: dict[int, int] = {}
    products_by_id: dict[int, Product] = {}

    for line in payload.lines:
        product: Product | None = None
        if line.product_id is not None:
            product = db.get(Product, line.product_id)
        elif line.amazon_sku:
            target_sku = line.amazon_sku.strip()
            mapping = db.scalar(
                select(AmazonProductMapping)
                .options(selectinload(AmazonProductMapping.product))
                .where(AmazonProductMapping.amazon_sku == target_sku)
            )
            if mapping and mapping.product:
                product = mapping.product
            else:
                product = db.scalar(select(Product).where(Product.amazon_sku == target_sku))
        elif line.sku:
            product = db.scalar(select(Product).where(Product.sku == line.sku.strip()))

        if product is None:
            raise HTTPException(
                status_code=404,
                detail=f"Product not found for line (product_id={line.product_id}, amazon_sku={line.amazon_sku}, sku={line.sku})",
            )
        if not product.is_active:
            raise HTTPException(status_code=400, detail=f"Product {product.sku} is inactive")

        if product.id not in before_qty_map:
            before_qty_map[product.id] = int(product.quantity_on_hand)
        products_by_id[product.id] = product

        note_parts = []
        if product.amazon_sku or line.amazon_sku:
            note_parts.append(f"Amazon SKU: {product.amazon_sku or line.amazon_sku}")
        if line.box_count:
            note_parts.append(f"{line.box_count} boxes")
        line_note = " | ".join(note_parts) if note_parts else None

        issue_lines_input.append(
            InventoryIssueLineCreate(
                product_id=product.id,
                quantity=line.quantity,
                unit="SALE",
                note=line_note,
            )
        )

    shipment_info = f"Shipment: {payload.shipment_id.strip()}" if payload.shipment_id else "Amazon FBA"
    issued_to = f"Amazon FBA Warehouse ({payload.shipment_id.strip()})" if payload.shipment_id else "Amazon FBA Warehouse"
    combined_note = (payload.note or "").strip()
    if payload.shipment_id:
        combined_note = f"[{shipment_info}] {combined_note}".strip()

    issue_body = InventoryIssueCreate(
        issued_to=issued_to,
        issued_by=payload.issued_by,
        purpose="AMAZON_FBA",
        note=combined_note or None,
        ignore_stock=payload.ignore_stock,
        lines=issue_lines_input,
    )

    issue = _create_issue(body=issue_body, db=db, actor_username=payload.issued_by)

    total_units = 0
    response_lines: list[dict] = []
    for line in payload.lines:
        p: Product | None = None
        if line.product_id:
            p = products_by_id.get(line.product_id)
        elif line.amazon_sku:
            p = next((prod for prod in products_by_id.values() if prod.amazon_sku == line.amazon_sku.strip()), None)
        elif line.sku:
            p = next((prod for prod in products_by_id.values() if prod.sku == line.sku.strip()), None)

        assert p is not None
        db.refresh(p)
        total_units += line.quantity
        response_lines.append({
            "product_id": p.id,
            "sku": p.sku,
            "amazon_sku": p.amazon_sku or line.amazon_sku,
            "product_name": p.name,
            "quantity": line.quantity,
            "box_count": line.box_count,
            "quantity_before": before_qty_map[p.id],
            "quantity_after": int(p.quantity_on_hand),
        })

    return AmazonFbaDispatchResponse(
        issue_id=issue.id,
        issue_number=issue.issue_number or f"ISS-{issue.id}",
        issued_at=issue.issued_at,
        purpose=issue.purpose,
        issued_to=issue.issued_to,
        total_units=total_units,
        note=issue.note,
        lines=response_lines,
    )


@router.get("/fba-history", response_model=list[InventoryIssueRead])
def get_fba_history(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
) -> list[InventoryIssue]:
    issues = db.scalars(
        select(InventoryIssue)
        .options(selectinload(InventoryIssue.lines))
        .where(InventoryIssue.purpose == "AMAZON_FBA")
        .order_by(InventoryIssue.issued_at.desc(), InventoryIssue.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return list(issues)


# --- FBA LIVE INVENTORY & AI RESTOCK RECOMMENDATION ---

_FBA_CACHE: dict = {"data": None, "timestamp": 0}
_FBA_CACHE_TTL_SECONDS = 300  # 5 minutes


def _fetch_fba_from_service(force_refresh: bool = False) -> list[dict]:
    import urllib.request
    import json
    import time
    
    global _FBA_CACHE
    now = time.time()
    if not force_refresh and _FBA_CACHE["data"] is not None and (now - _FBA_CACHE["timestamp"]) < _FBA_CACHE_TTL_SECONDS:
        return _FBA_CACHE["data"]

    url = f"{AMAZON_SHIPPING_BASE_URL}/inventory/fba?in_stock_only=false"
    req = urllib.request.Request(
        url,
        headers={"Authorization": "Bearer your_secret_api_key_here"}
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode())
            items = data.get("items", [])
            _FBA_CACHE = {"data": items, "timestamp": now}
            return items
    except Exception as exc:
        if _FBA_CACHE["data"] is not None:
            return _FBA_CACHE["data"]
        raise HTTPException(
            status_code=502,
            detail=f"Khong the ket noi den Amazon Shipping Service: {exc}"
        ) from exc



def _is_renew_or_used(it: dict) -> bool:
    sku = (it.get("sku") or "").strip().lower()
    cond = (it.get("condition") or "").strip()
    name = (it.get("product_name") or "").strip().lower()
    if sku.startswith("amzn.") or "amzn.gr" in sku or "amz:" in sku:
        return True
    if "amz:" in name:
        return True
    if cond and cond != "NewItem":
        return True
    return False


@router.get("/fba-inventory", response_model=AmazonFbaInventorySummary)
def get_amazon_fba_inventory(
    force_refresh: bool = False,
    in_stock_only: bool = True,
    search: str | None = None,
    db: Session = Depends(get_db),
) -> AmazonFbaInventorySummary:
    from datetime import datetime, timezone
    
    fba_items = _fetch_fba_from_service(force_refresh=force_refresh)
    
    # Load products & mappings for joining
    prods = db.scalars(select(Product)).all()
    prod_by_amz_sku = {p.amazon_sku: p for p in prods if p.amazon_sku}
    prod_by_id = {p.id: p for p in prods}
    
    mappings = db.scalars(select(AmazonProductMapping)).all()
    mapping_by_amz_sku = {m.amazon_sku: m for m in mappings}
    
    mapped_items: list[AmazonFbaItemStock] = []
    
    total_fulfillable = 0
    total_inbound = 0
    total_reserved = 0
    low_stock_count = 0
    out_of_stock_count = 0
    healthy_count = 0
    
    for it in fba_items:
        if _is_renew_or_used(it):
            continue
        sku = it.get("sku") or ""
        total_qty = int(it.get("total_quantity", 0))
        fulfillable_qty = int(it.get("fulfillable_quantity", 0))
        inbound_qty = int(it.get("inbound_quantity", 0))
        reserved_qty = int(it.get("reserved_quantity", 0))
        
        if in_stock_only and total_qty <= 0:
            continue
            
        # Match with ULINK Product
        prod = prod_by_amz_sku.get(sku)
        mapping = mapping_by_amz_sku.get(sku)
        if not prod and mapping and mapping.product_id:
            prod = prod_by_id.get(mapping.product_id)
            
        is_mapped = prod is not None
        ulink_product_id = prod.id if prod else None
        ulink_sku = prod.sku if prod else None
        ulink_product_name = prod.name if prod else None
        ulink_stock = int(prod.quantity_on_hand) if prod else 0
        image_url = prod.image_url if prod else None
        uom = prod.uom if prod and prod.uom else "Dozen"
        uom_multiplier = prod.uom_multiplier if prod and prod.uom_multiplier else 1
        if uom_multiplier <= 1:
            if "600GSM" in sku:
                uom_multiplier = 6
                uom = "6 Pack"
            elif any(k in sku for k in ["12Pack", "24Pack", "TWH_", "1628", "1313"]) or "Towel" in (it.get("product_name") or ""):
                uom_multiplier = 12
                uom = "Dozen"
            else:
                uom_multiplier = 1
                uom = "cái"
        ulink_stock_uom = ulink_stock // uom_multiplier if uom_multiplier > 0 else ulink_stock
        
        # Calculate stock status
        if fulfillable_qty <= 0:
            status = "OUT_OF_STOCK"
            out_of_stock_count += 1
        elif fulfillable_qty < 10:
            status = "LOW_STOCK"
            low_stock_count += 1
        else:
            status = "HEALTHY"
            healthy_count += 1
            
        total_fulfillable += fulfillable_qty
        total_inbound += inbound_qty
        total_reserved += reserved_qty
        
        # Search filter
        if search:
            q = search.lower().strip()
            item_name = (it.get("product_name") or "").lower()
            u_name = (ulink_product_name or "").lower()
            if q not in sku.lower() and q not in (it.get("asin") or "").lower() and q not in item_name and q not in u_name and q not in (ulink_sku or "").lower():
                continue
                
        mapped_items.append(
            AmazonFbaItemStock(
                sku=sku,
                asin=it.get("asin"),
                product_name=it.get("product_name"),
                condition=it.get("condition"),
                total_quantity=total_qty,
                fulfillable_quantity=fulfillable_qty,
                inbound_quantity=inbound_qty,
                reserved_quantity=reserved_qty,
                ulink_product_id=ulink_product_id,
                ulink_sku=ulink_sku,
                ulink_product_name=ulink_product_name,
                ulink_stock=ulink_stock,
                uom=uom,
                uom_multiplier=uom_multiplier,
                ulink_stock_uom=ulink_stock_uom,
                image_url=image_url,
                status=status,
                is_mapped=is_mapped,
            )
        )
        
    # Sort items: OUT_OF_STOCK first, then LOW_STOCK, then HEALTHY
    priority = {"OUT_OF_STOCK": 0, "LOW_STOCK": 1, "HEALTHY": 2}
    mapped_items.sort(key=lambda x: (priority.get(x.status, 3), -x.ulink_stock, x.sku))
    
    return AmazonFbaInventorySummary(
        total_items=len(mapped_items),
        total_fulfillable=total_fulfillable,
        total_inbound=total_inbound,
        total_reserved=total_reserved,
        low_stock_count=low_stock_count,
        out_of_stock_count=out_of_stock_count,
        healthy_count=healthy_count,
        items=mapped_items,
        last_updated=datetime.now(timezone.utc),
    )


@router.post("/suggest-restock", response_model=AmazonRestockSuggestionResponse)
def suggest_fba_restock(
    payload: AmazonRestockSuggestRequest,
    db: Session = Depends(get_db),
) -> AmazonRestockSuggestionResponse:
    fba_items = _fetch_fba_from_service(force_refresh=False)
    
    prods = db.scalars(select(Product)).all()
    prod_by_amz_sku = {p.amazon_sku: p for p in prods if p.amazon_sku}
    prod_by_id = {p.id: p for p in prods}
    
    mappings = db.scalars(
        select(AmazonProductMapping).options(selectinload(AmazonProductMapping.capacities))
    ).all()
    mapping_by_amz_sku = {m.amazon_sku: m for m in mappings}
    
    box_types = db.scalars(select(AmazonBoxType).where(AmazonBoxType.is_active == True)).all()
    box_by_id = {b.id: b for b in box_types}
    default_box = box_types[0] if box_types else None
    
    # Filter items
    candidates = []
    selected_set = set(payload.selected_skus) if payload.selected_skus else None
    
    for it in fba_items:
        if _is_renew_or_used(it):
            continue
        sku = it.get("sku") or ""
        total_qty = int(it.get("total_quantity", 0))
        fulfillable_qty = int(it.get("fulfillable_quantity", 0))
        inbound_qty = int(it.get("inbound_quantity", 0))
        
        # Match with ULINK Product
        prod = prod_by_amz_sku.get(sku)
        mapping = mapping_by_amz_sku.get(sku)
        if not prod and mapping and mapping.product_id:
            prod = prod_by_id.get(mapping.product_id)
            
        if not prod:
            continue
            
        ulink_stock = int(prod.quantity_on_hand)
        if ulink_stock <= 0:
            continue
            
        if selected_set is not None:
            if sku not in selected_set:
                continue
        else:
            # Automatic scan: only suggest if out of stock or low stock on Amazon
            if fulfillable_qty >= 15:
                continue
                
        candidates.append((it, prod, mapping))
        
    suggested_items: list[AmazonRestockSuggestionItem] = []
    total_boxes = 0
    total_units = 0
    warnings: list[str] = []
    
    for it, prod, mapping in candidates:
        sku = it.get("sku")
        fulfillable_qty = int(it.get("fulfillable_quantity", 0))
        inbound_qty = int(it.get("inbound_quantity", 0))
        ulink_stock = int(prod.quantity_on_hand)
        
        uom = prod.uom if prod and prod.uom else "Dozen"
        uom_multiplier = prod.uom_multiplier if prod and prod.uom_multiplier else 1
        if uom_multiplier <= 1:
            if "600GSM" in sku:
                uom_multiplier = 6
                uom = "6 Pack"
            elif any(k in sku for k in ["12Pack", "24Pack", "TWH_", "1628", "1313"]) or "Towel" in prod.name:
                uom_multiplier = 12
                uom = "Dozen"
            else:
                uom_multiplier = 1
                uom = "cái"
        ulink_available_dozens = ulink_stock // uom_multiplier if uom_multiplier > 0 else ulink_stock

        # Determine capacity per box (in Dozen/Pack)
        units_per_box = 14  # Default standard 16x28 towel pack
        box_id = default_box.id if default_box else None
        box_name = default_box.name if default_box else "Thung FBA Chuan"
        
        if mapping and mapping.capacities:
            cap = mapping.capacities[0]
            units_per_box = cap.units_capacity
            box_id = cap.box_type_id
            if box_id in box_by_id:
                box_name = box_by_id[box_id].name
            
        # Amazon rule: At least 5 identical boxes
        target_boxes = max(payload.min_boxes, payload.target_boxes_per_sku)
        needed_units = target_boxes * units_per_box
        
        can_fulfill = ulink_available_dozens >= needed_units
        actual_boxes = target_boxes
        
        if not can_fulfill:
            possible_boxes = ulink_available_dozens // units_per_box
            if possible_boxes >= 5:
                actual_boxes = possible_boxes
                reason = f"Kho ULINK còn {ulink_available_dozens} {uom} ({ulink_stock} cái lẻ), đủ đóng {actual_boxes} thùng × {units_per_box} {uom} (chuẩn >= 5 thùng)."
            elif possible_boxes > 0:
                actual_boxes = possible_boxes
                reason = f"CẢNH BÁO: Kho ULINK chỉ còn {ulink_available_dozens} {uom} ({actual_boxes} thùng), không đủ chuẩn 5 thùng FBA!"
                warnings.append(f"{prod.name}: Kho nhà chỉ đủ {actual_boxes} thùng (Amazon yêu cầu >= 5 thùng).")
            else:
                actual_boxes = 0
                reason = f"Kho nhà chỉ còn {ulink_available_dozens} {uom} ({ulink_stock} cái lẻ), không đủ đóng 1 thùng ({units_per_box} {uom})."
        else:
            if fulfillable_qty == 0:
                reason = f"Hàng FBA đã HẾT SẠCH (0 {uom}). Gợi ý đóng ngay {actual_boxes} thùng ({actual_boxes * units_per_box} {uom} = {actual_boxes * units_per_box * uom_multiplier} cái) để restock."
            else:
                reason = f"Hàng FBA sắp hết (còn {fulfillable_qty} {uom}). Đóng {actual_boxes} thùng × {units_per_box} {uom} = {actual_boxes * units_per_box} {uom} ({actual_boxes * units_per_box * uom_multiplier} cái)."
                
        pick_units = actual_boxes * units_per_box
        if actual_boxes > 0:
            total_boxes += actual_boxes
            total_units += pick_units
            
            suggested_items.append(
                AmazonRestockSuggestionItem(
                    amazon_sku=sku,
                    asin=it.get("asin"),
                    ulink_product_id=prod.id,
                    ulink_sku=prod.sku,
                    product_name=prod.name,
                    image_url=prod.image_url,
                    current_fba_fulfillable=fulfillable_qty,
                    current_fba_inbound=inbound_qty,
                    ulink_available_stock=ulink_stock,
                    ulink_available_dozens=ulink_available_dozens,
                    uom=uom,
                    uom_multiplier=uom_multiplier,
                    box_type_id=box_id,
                    box_name=box_name,
                    units_per_box=units_per_box,
                    suggested_boxes=actual_boxes,
                    total_units_to_pick=pick_units,
                    total_pieces_to_pick=pick_units * uom_multiplier,
                    ai_reasoning=reason,
                    can_fulfill=can_fulfill,
                )
            )
            
    return AmazonRestockSuggestionResponse(
        total_boxes=total_boxes,
        total_units=total_units,
        items=suggested_items,
        warnings=warnings,
    )


@router.get("/shipments-hub", response_model=AmazonShipmentsHubResponse)
def get_amazon_shipments_hub(db: Session = Depends(get_db)) -> AmazonShipmentsHubResponse:
    import json
    import os
    from collections import defaultdict
    from datetime import datetime

    file_path = "/home/thanhtung/StorageManagementWeb-ULINK/backend/data/amazon_fba_shipments_history.json"
    if not os.path.exists(file_path):
        file_path = "/tmp/amazon_fba_all_batches.json"

    batches_data = {}
    if os.path.exists(file_path):
        try:
            with open(file_path, "r") as f:
                batches_data = json.load(f)
        except Exception:
            batches_data = {}

    # Load FBM history
    fbm_file = "/home/thanhtung/StorageManagementWeb-ULINK/backend/data/amazon_fbm_orders_history.json"
    if not os.path.exists(fbm_file):
        fbm_file = "/tmp/fbm_orders_cache.json"
    fbm_orders_data = []
    if os.path.exists(fbm_file):
        try:
            with open(fbm_file, "r") as f:
                fbm_orders_data = json.load(f)
        except Exception:
            fbm_orders_data = []

    prods = db.scalars(select(Product)).all()
    prod_by_amz = {p.amazon_sku: p for p in prods if p.amazon_sku}
    mappings = db.scalars(select(AmazonProductMapping)).all()
    for m in mappings:
        if m.amazon_sku and m.product_id:
            p = db.get(Product, m.product_id)
            if p:
                prod_by_amz[m.amazon_sku] = p

    fba_issues = db.scalars(
        select(InventoryIssue)
        .where(InventoryIssue.purpose == "AMAZON_FBA")
        .order_by(InventoryIssue.issued_at.desc())
    ).all()

    def find_issue_for_date(dt_str: str) -> InventoryIssue | None:
        try:
            m, d, y = map(int, dt_str.split("/"))
            target_dt = datetime(y, m, d).date()
        except Exception:
            return None
        
        for iss in fba_issues:
            if iss.issued_at:
                iss_dt = iss.issued_at.date()
                if abs((iss_dt - target_dt).days) <= 4:
                    return iss
        return None

    sku_totals = defaultdict(int)
    batches_list = []
    total_units_all = 0
    total_shipments_all = 0

    def parse_batch_date(dt_str: str):
        try:
            m, d, y = map(int, dt_str.split("/"))
            return datetime(y, m, d)
        except Exception:
            return datetime.min

    sorted_dates = sorted(batches_data.keys(), key=parse_batch_date, reverse=True)

    for dt in sorted_dates:
        info = batches_data[dt]
        s_count = int(info.get("shipments_count", 0))
        b_units = int(info.get("total_units", 0))
        total_shipments_all += s_count
        total_units_all += b_units

        matched_issue = find_issue_for_date(dt)

        batch_items = []
        for sku, q in sorted(info.get("skus", {}).items(), key=lambda x: -x[1]):
            sku_totals[sku] += q
            p = prod_by_amz.get(sku)
            batch_items.append(
                AmazonShipmentBatchItem(
                    amazon_sku=sku,
                    ulink_sku=p.sku if p else None,
                    product_name=p.name if p else "(Khác/Kềm/Liner)",
                    quantity=q,
                )
            )

        batches_list.append(
            AmazonShipmentBatch(
                date=dt,
                display_date=dt,
                shipments_count=s_count,
                total_units=b_units,
                issue_number=matched_issue.issue_number if matched_issue else None,
                issue_id=matched_issue.id if matched_issue else None,
                is_synced=matched_issue is not None,
                items=batch_items,
            )
        )

    # Process FBM statistics
    fbm_units_total = 0
    fbm_sku_totals = defaultdict(int)
    fbm_to_base_sku = {
        "TWH_1628_White_72Pack": ("TWH_1628_White_12Pack", 6),
        "TWH_1628_Black_72Pack": ("TWH_1628_White_24Pack", 6),
        "TWH_1628_Grey_72Pack": ("TWH_1628_Grey_12Pack", 6),
        "TWH_1628_Yellow_72Pack": ("TWH_1628_Yellow_12Pack", 6),
        "TWH_1628_Turquoise_72Pack": ("TWH_1628_Turquoise_12Pack", 6),
        "TWH_1628_Orange_72Pack": ("TWH_1628_Orange_12Pack", 6),
        "TWH_1628_Pink_72Pack": ("TWH_1628_Pink_12Pack", 6),
        "TWH_1628_Teal_72Pack": ("TWH_1628_Teal_12Pack", 6),
        "TWH_1628_Green_72Pack": ("TWH_1628_Green_12Pack", 6),
        "TWH_1628_Navy_72Pack": ("TWH_1628_Navy_12Pack", 6),
        "TWH_1628_Brown_72Pack": ("TWH_1628_Brown_12Pack", 6),
        "TWH_1313_White_108Pack": ("TWH_1313_White_12Pack", 9),
        "TWH_1313_Pink_108Pack": ("TWH_1313_Pink_12Pack", 9),
    }

    for fo in fbm_orders_data:
        for it in fo.get("items", []):
            f_sku = it.get("sku")
            q = int(it.get("quantity", 1))
            target_sku, mult = fbm_to_base_sku.get(f_sku, (f_sku, 6))
            dozens = q * mult
            fbm_units_total += dozens
            fbm_sku_totals[target_sku] += dozens

    all_skus = set(sku_totals.keys()) | set(fbm_sku_totals.keys())
    product_totals_list = []
    for sku in all_skus:
        p = prod_by_amz.get(sku)
        fba_q = sku_totals.get(sku, 0)
        fbm_q = fbm_sku_totals.get(sku, 0)
        product_totals_list.append(
            AmazonShipmentProductTotal(
                amazon_sku=sku,
                ulink_sku=p.sku if p else None,
                product_name=p.name if p else "(Khác/Kềm/Liner)",
                total_shipped=fba_q + fbm_q,
                fba_shipped=fba_q,
                fbm_shipped=fbm_q,
                image_url=p.image_url if p else None,
            )
        )

    product_totals_list.sort(key=lambda x: -x.total_shipped)

    return AmazonShipmentsHubResponse(
        total_units_all_time=total_units_all,
        total_shipments_all_time=total_shipments_all,
        total_batches_all_time=len(batches_list),
        fba_units_total=total_units_all,
        fbm_units_total=fbm_units_total,
        fbm_orders_total=len(fbm_orders_data),
        combined_total_units=total_units_all + fbm_units_total,
        product_totals=product_totals_list,
        batches=batches_list,
    )


@router.get("/fbm-orders", response_model=AmazonFbmOrdersResponse)
def get_amazon_fbm_orders(
    status: str = "ALL",
    db: Session = Depends(get_db),
) -> AmazonFbmOrdersResponse:
    import json
    import os
    from datetime import datetime

    fbm_file = "/home/thanhtung/StorageManagementWeb-ULINK/backend/data/amazon_fbm_orders_history.json"
    if not os.path.exists(fbm_file):
        fbm_file = "/tmp/fbm_orders_cache.json"

    orders_raw = []
    if os.path.exists(fbm_file):
        try:
            with open(fbm_file, "r") as f:
                orders_raw = json.load(f)
        except Exception:
            orders_raw = []

    prods = db.scalars(select(Product)).all()
    prod_by_id = {p.id: p for p in prods}
    mappings = db.scalars(select(AmazonProductMapping)).all()
    prod_by_amz_sku = {}
    for m in mappings:
        if m.amazon_sku and m.product_id:
            p = prod_by_id.get(m.product_id)
            if p:
                prod_by_amz_sku[m.amazon_sku] = p

    fbm_issues = db.scalars(
        select(InventoryIssue)
        .where(InventoryIssue.purpose == "AMAZON_FBM")
        .order_by(InventoryIssue.issued_at.desc())
    ).all()

    orders_list = []
    total_packs = 0
    total_dozens = 0
    total_pieces = 0
    shipped_count = 0
    unshipped_count = 0

    for o in orders_raw:
        st = o.get("order_status", "Shipped")
        if st == "Shipped":
            shipped_count += 1
        else:
            unshipped_count += 1

        if status != "ALL" and st.lower() != status.lower():
            continue

        oid = o.get("order_id")
        pdate = o.get("purchase_date", "")

        # Match with issue slip
        matched_issue = None
        for iss in fbm_issues:
            if (iss.note and oid in iss.note) or (iss.issued_to and oid in iss.issued_to):
                matched_issue = iss
                break
        if not matched_issue and pdate:
            try:
                o_dt = datetime.fromisoformat(pdate.replace("Z", "+00:00")).date()
                for iss in fbm_issues:
                    if iss.issued_at and abs((iss.issued_at.date() - o_dt).days) <= 1:
                        matched_issue = iss
                        break
            except Exception:
                pass

        items_list = []
        for it in o.get("items", []):
            sku = it.get("sku")
            qty = int(it.get("quantity", 1))
            total_packs += qty
            dozens_per_pack = 9 if "108Pack" in sku else 6
            d_qty = qty * dozens_per_pack
            p_qty = d_qty * 12
            total_dozens += d_qty
            total_pieces += p_qty

            p = prod_by_amz_sku.get(sku)
            items_list.append(
                AmazonFbmItem(
                    sku=sku,
                    quantity=qty,
                    title=it.get("title"),
                    price=it.get("price"),
                    dozens=d_qty,
                    pieces=p_qty,
                    ulink_sku=p.sku if p else None,
                    ulink_product_name=p.name if p else None,
                    product_id=p.id if p else None,
                )
            )

        orders_list.append(
            AmazonFbmOrder(
                order_id=oid,
                purchase_date=pdate,
                order_status=st,
                recipient_name=o.get("recipient_name"),
                city=o.get("city"),
                state=o.get("state"),
                postal_code=o.get("postal_code"),
                order_total=str(o.get("order_total") or ""),
                currency=o.get("currency", "USD"),
                items=items_list,
                issue_number=matched_issue.issue_number if matched_issue else None,
                issue_id=matched_issue.id if matched_issue else None,
                is_synced=matched_issue is not None,
            )
        )

    orders_list.sort(key=lambda x: x.purchase_date, reverse=True)

    return AmazonFbmOrdersResponse(
        total_orders=len(orders_list),
        shipped_orders_count=shipped_count,
        unshipped_orders_count=unshipped_count,
        total_packs=total_packs,
        total_dozens=total_dozens,
        total_pieces=total_pieces,
        orders=orders_list,
    )


@router.post("/create-fba-inbound-shipment", response_model=CreateFbaInboundShipmentResponse)
def create_fba_inbound_shipment(
    payload: CreateFbaInboundShipmentRequest,
    db: Session = Depends(get_db),
) -> CreateFbaInboundShipmentResponse:
    import json
    import urllib.request
    from app.schemas.inventory import InventoryIssueCreate, InventoryIssueLineCreate

    prods = db.scalars(select(Product)).all()
    prod_by_amz_sku = {p.amazon_sku: p for p in prods if p.amazon_sku}
    prod_by_id = {p.id: p for p in prods}
    prod_by_sku = {p.sku: p for p in prods if p.sku}

    mappings = db.scalars(select(AmazonProductMapping)).all()
    mapping_by_amz_sku = {m.amazon_sku: m for m in mappings}

    issue_lines: list[InventoryIssueLineCreate] = []
    processed_lines = []
    total_boxes = 0
    total_units = 0
    total_pieces = 0

    for line in payload.lines:
        amz_sku = line.amazon_sku.strip()
        prod = None
        if line.product_id:
            prod = prod_by_id.get(line.product_id)
        if not prod and line.sku:
            prod = prod_by_sku.get(line.sku)
        if not prod:
            prod = prod_by_amz_sku.get(amz_sku)
        if not prod and amz_sku in mapping_by_amz_sku:
            mp = mapping_by_amz_sku[amz_sku]
            if mp.product_id:
                prod = prod_by_id.get(mp.product_id)

        if not prod:
            raise HTTPException(
                status_code=400,
                detail=f"Khong tim thay san pham ULINK tuong ung voi SKU Amazon: {amz_sku}"
            )

        uom_mult = prod.uom_multiplier if prod.uom_multiplier and prod.uom_multiplier > 0 else 1
        qty_units = line.quantity
        line_pieces = qty_units * uom_mult

        if prod.quantity_on_hand < line_pieces:
            raise HTTPException(
                status_code=400,
                detail=f"Kho ULINK khong du ton cho san pham {prod.name} ({prod.sku}). Con {prod.quantity_on_hand} cai le, can {line_pieces} cai le ({qty_units} {prod.uom})."
            )

        note_line = f"Amazon SKU: {amz_sku} | {line.box_count} thung x {line.units_per_box} {prod.uom} = {qty_units} {prod.uom}"
        issue_lines.append(
            InventoryIssueLineCreate(
                product_id=prod.id,
                quantity=qty_units,
                unit="SALE",
                note=note_line,
            )
        )

        total_boxes += line.box_count
        total_units += qty_units
        total_pieces += line_pieces

        processed_lines.append({
            "amazon_sku": amz_sku,
            "product_id": prod.id,
            "sku": prod.sku,
            "product_name": prod.name,
            "box_count": line.box_count,
            "units_per_box": line.units_per_box,
            "quantity": qty_units,
            "pieces": line_pieces,
            "uom": prod.uom,
        })

    inbound_plan_id = None
    if payload.create_sp_api_plan:
        service_url = f"{AMAZON_SHIPPING_BASE_URL}/inventory/inbound/create-plan"
        sp_items = []
        for l in payload.lines:
            sp_items.append({
                "msku": l.amazon_sku.strip(),
                "quantity": l.quantity,
                "labelOwner": "SELLER",
                "prepOwner": "SELLER",
            })

        sp_payload = {
            "name": payload.shipment_name or "ULINK FBA Shipment Plan",
            "sourceAddress": payload.source_address or {
                "name": "Thai Nguyen",
                "addressLine1": "3900 S Grand Blvd",
                "city": "St. Louis",
                "stateOrProvinceCode": "MO",
                "countryCode": "US",
                "postalCode": "63118",
                "phoneNumber": "3145550199",
            },
            "items": sp_items,
        }

        req = urllib.request.Request(
            service_url,
            headers={
                "Authorization": "Bearer your_secret_api_key_here",
                "Content-Type": "application/json",
            },
            data=json.dumps(sp_payload).encode(),
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp_data = json.loads(resp.read().decode())
                inbound_plan_id = resp_data.get("inboundPlanId")
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Loi tao Inbound Plan qua Amazon SP-API: {exc}"
            ) from exc

    shipment_ref = inbound_plan_id or payload.manual_shipment_id or payload.shipment_name or "FBA-SHIPMENT"
    full_note = f"Amazon FBA Inbound Shipment: {shipment_ref}. Tong {total_boxes} thung, {total_units} Dozen/Pack ({total_pieces} cai)."
    if payload.note:
        full_note += f" | Ghi chu: {payload.note}"

    issue_create = InventoryIssueCreate(
        issued_to="AMAZON_FBA",
        purpose="AMAZON_FBA",
        issued_by=payload.issued_by or "thainguyen",
        note=full_note,
        lines=issue_lines,
    )

    created_issue = _create_issue(
        body=issue_create,
        db=db,
        actor_username=payload.issued_by or "thainguyen",
    )

    return CreateFbaInboundShipmentResponse(
        success=True,
        issue_id=created_issue.id,
        issue_number=created_issue.issue_number,
        inbound_plan_id=inbound_plan_id,
        shipment_id=payload.manual_shipment_id or inbound_plan_id,
        total_boxes=total_boxes,
        total_units=total_units,
        total_pieces=total_pieces,
        lines=processed_lines,
    )


# =========================================================================
# Bridge Endpoints to amazon-shipping (SP-API Fulfillment Inbound v2024-03-20)
# =========================================================================

AMAZON_SHIPPING_API_KEY = "your_secret_api_key_here"

def _call_amazon_shipping_service(endpoint: str, method: str = "GET", payload: dict = None, timeout: int = 40):
    url = f"{AMAZON_SHIPPING_BASE_URL}{endpoint}"
    data_bytes = json.dumps(payload).encode() if payload is not None else None
    headers = {
        "Authorization": f"Bearer {AMAZON_SHIPPING_API_KEY}",
        "Content-Type": "application/json"
    }
    req = urllib.request.Request(url, headers=headers, data=data_bytes, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as he:
        err_msg = he.read().decode()
        raise HTTPException(status_code=he.code, detail=f"Lỗi từ Amazon Shipping Service ({he.code}): {err_msg}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Không thể kết nối Amazon Shipping Service: {exc}")


@router.post("/inbound/{inbound_plan_id}/set-packing-information")
def bridge_set_packing_information(inbound_plan_id: str, payload: dict):
    """Khai báo thông tin thùng (đơn hoặc ghép SKU) lên SP-API Inbound."""
    return _call_amazon_shipping_service(
        f"/inventory/inbound/{inbound_plan_id}/set-packing-information",
        method="POST",
        payload=payload,
        timeout=35
    )


@router.get("/inbound/{inbound_plan_id}/placement-options")
def bridge_get_placement_options(inbound_plan_id: str):
    """Lấy danh sách các Placement Options và phân loại kho East, Central, West, Split."""
    return _call_amazon_shipping_service(
        f"/inventory/inbound/{inbound_plan_id}/placement-options",
        method="GET",
        timeout=35
    )


@router.post("/inbound/{inbound_plan_id}/transportation-options")
def bridge_get_transportation_options(inbound_plan_id: str, payload: dict):
    """Lấy và báo giá vận chuyển (UPS Partnered, LTL Freight, Non-partnered) cho 1 placement."""
    return _call_amazon_shipping_service(
        f"/inventory/inbound/{inbound_plan_id}/transportation-options",
        method="POST",
        payload=payload,
        timeout=45
    )


@router.get("/inbound/{inbound_plan_id}/quote-all-options")
def bridge_quote_all_options(inbound_plan_id: str):
    """So sánh toàn diện tất cả các option East, Central, West, Split kèm cước UPS Partnered & LTL."""
    return _call_amazon_shipping_service(
        f"/inventory/inbound/{inbound_plan_id}/quote-all-options",
        method="GET",
        timeout=60
    )


@router.post("/inbound/{inbound_plan_id}/confirm-placement-and-carrier")
def bridge_confirm_placement_and_carrier(inbound_plan_id: str, payload: dict):
    """Xác nhận Placement Option và Carrier trên Amazon SP-API."""
    return _call_amazon_shipping_service(
        f"/inventory/inbound/{inbound_plan_id}/confirm-placement-and-carrier",
        method="POST",
        payload=payload,
        timeout=45
    )


@router.get("/inbound/{inbound_plan_id}/shipments/{shipment_confirmation_id}/labels")
def bridge_get_shipment_labels(
    inbound_plan_id: str,
    shipment_confirmation_id: str,
    page_type: str = "PackageLabel_Letter_2",
    number_of_packages: int = 5
):
    """Lấy link tải tem thùng FBA (PDF) từ SP-API."""
    query = f"?page_type={page_type}&number_of_packages={number_of_packages}"
    return _call_amazon_shipping_service(
        f"/inventory/inbound/{inbound_plan_id}/shipments/{shipment_confirmation_id}/labels{query}",
        method="GET",
        timeout=35
    )

@router.get("/inbound/{inbound_plan_id}/details")
def bridge_get_inbound_plan_details(inbound_plan_id: str):
    """Lấy chi tiết và trạng thái của Inbound Plan."""
    return _call_amazon_shipping_service(
        f"/inventory/inbound/{inbound_plan_id}",
        method="GET",
        timeout=25
    )


@router.put("/inbound/{inbound_plan_id}/cancel")
def bridge_cancel_inbound_plan(inbound_plan_id: str):
    """Hủy Inbound Plan trên Amazon SP-API."""
    return _call_amazon_shipping_service(
        f"/inventory/inbound/{inbound_plan_id}/cancel",
        method="PUT",
        timeout=35
    )
