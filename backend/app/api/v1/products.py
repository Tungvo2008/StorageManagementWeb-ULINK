from decimal import Decimal
from io import BytesIO
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db
from app.core.config import settings
from app.db.models import Category, Product
from app.schemas.product import ProductCreate, ProductImportResult, ProductRead, ProductUpdate


router = APIRouter(prefix="/products")

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _has_python_multipart() -> bool:
    try:
        import multipart  # type: ignore  # noqa: F401
    except Exception:
        return False
    return True


def _openpyxl():
    try:
        from openpyxl import Workbook, load_workbook  # type: ignore
        from openpyxl.styles import Font  # type: ignore
    except Exception as e:
        raise RuntimeError("Missing dependency: openpyxl. Please `pip install openpyxl`.") from e
    return Workbook, load_workbook, Font


def _cell_str(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def _parse_bool(v: Any, default: bool = True) -> bool:
    s = _cell_str(v).lower()
    if not s:
        return default
    return s in {"1", "true", "yes", "y", "active"}


class _ProductExcelImportError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("\n".join(errors))
        self.errors = errors


def _build_products_template_xlsx() -> bytes:
    Workbook, _, Font = _openpyxl()
    wb = Workbook()
    ws = wb.active
    ws.title = "Products Import"
    ws.append(["sku", "name", "base_uom", "uom", "is_active"])
    ws.append(["ULNEW001", "Sample Product", "Pc", "Dozen", True])
    for cell in ws[1]:
        cell.font = Font(bold=True)
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 40
    ws.column_dimensions["C"].width = 14
    ws.column_dimensions["D"].width = 14
    ws.column_dimensions["E"].width = 12

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _build_products_export_xlsx(products: list[Product]) -> bytes:
    Workbook, _, Font = _openpyxl()
    wb = Workbook()
    ws = wb.active
    ws.title = "Products"
    ws.append(["id", "sku", "name", "base_uom", "uom", "is_active"])
    for p in products:
        ws.append([p.id, p.sku, p.name, p.base_uom, p.uom, bool(p.is_active)])
    for cell in ws[1]:
        cell.font = Font(bold=True)
    ws.column_dimensions["A"].width = 10
    ws.column_dimensions["B"].width = 20
    ws.column_dimensions["C"].width = 40
    ws.column_dimensions["D"].width = 14
    ws.column_dimensions["E"].width = 14
    ws.column_dimensions["F"].width = 12

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _parse_products_import_xlsx(file_bytes: bytes) -> list[dict[str, Any]]:
    _, load_workbook, _ = _openpyxl()
    wb = load_workbook(filename=BytesIO(file_bytes), data_only=True)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise _ProductExcelImportError(["Empty workbook"])

    header = [(_cell_str(x) or "").strip().lower() for x in (rows[0] or [])]
    if "sku" not in header:
        raise _ProductExcelImportError(["Missing column: sku"])
    if "name" not in header:
        raise _ProductExcelImportError(["Missing column: name"])

    idx = {name: header.index(name) for name in header}
    errors: list[str] = []
    items: list[dict[str, Any]] = []
    for row_i, row in enumerate(rows[1:], start=2):
        row_vals = list(row or [])
        sku = _cell_str(row_vals[idx["sku"]] if idx["sku"] < len(row_vals) else "")
        name = _cell_str(row_vals[idx["name"]] if idx["name"] < len(row_vals) else "")
        if not sku and not name:
            continue
        if not sku:
            errors.append(f"Row {row_i}: missing sku")
            continue
        if not name:
            errors.append(f"Row {row_i}: missing name")
            continue

        base_uom = _cell_str(row_vals[idx["base_uom"]] if "base_uom" in idx and idx["base_uom"] < len(row_vals) else "")
        uom = _cell_str(row_vals[idx["uom"]] if "uom" in idx and idx["uom"] < len(row_vals) else "")
        is_active_raw = row_vals[idx["is_active"]] if "is_active" in idx and idx["is_active"] < len(row_vals) else None

        base_uom = base_uom or "Pc"
        uom = uom or "Pc"
        is_active = _parse_bool(is_active_raw, default=True)

        items.append(
            {
                "sku": sku,
                "name": name,
                "base_uom": base_uom,
                "uom": uom,
                "is_active": is_active,
            }
        )

    if errors:
        raise _ProductExcelImportError(errors)
    if not items:
        raise _ProductExcelImportError(["No product rows found"])
    return items


@router.get("", response_model=list[ProductRead])
def list_products(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> list[Product]:
    stmt = select(Product).options(selectinload(Product.category)).offset(skip).limit(limit)
    return db.scalars(stmt).all()


@router.post("", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(product_in: ProductCreate, db: Session = Depends(get_db)) -> Product:
    existing = db.scalar(select(Product).where(Product.sku == product_in.sku))
    if existing is not None:
        raise HTTPException(status_code=409, detail="SKU already exists")

    category_id = product_in.category_id
    if category_id is not None:
        cat = db.get(Category, category_id)
        if cat is None:
            raise HTTPException(status_code=400, detail="Invalid category_id")

    currency = product_in.currency or settings.DEFAULT_CURRENCY
    base_uom = (product_in.base_uom or "Pc").strip() or "Pc"
    uom = (product_in.uom or "Pc").strip() or "Pc"
    uom_multiplier = product_in.uom_multiplier
    if uom_multiplier is None:
        uom_multiplier = 12 if uom.lower() == "dozen" else 1
    product = Product(
        category_id=category_id,
        sku=product_in.sku,
        name=product_in.name,
        description=product_in.description,
        image_url=product_in.image_url,
        base_uom=base_uom,
        uom=uom,
        uom_multiplier=uom_multiplier,
        cost_price=product_in.cost_price or Decimal("0"),
        unit_price=product_in.unit_price or Decimal("0"),
        currency=currency,
        quantity_on_hand=product_in.quantity_on_hand,
        is_active=product_in.is_active,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.get("/template.xlsx")
def download_products_template() -> Response:
    try:
        xlsx = _build_products_template_xlsx()
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e)) from e
    return Response(
        content=xlsx,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": 'attachment; filename="products-import-template.xlsx"'},
    )


@router.get("/export.xlsx")
def export_products_xlsx(db: Session = Depends(get_db)) -> Response:
    products = db.scalars(select(Product).order_by(Product.id.asc())).all()
    try:
        xlsx = _build_products_export_xlsx(products)
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e)) from e
    return Response(
        content=xlsx,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": 'attachment; filename="products-export.xlsx"'},
    )


if _has_python_multipart():

    @router.post("/import", response_model=ProductImportResult)
    async def import_products_xlsx(file: UploadFile = File(...), db: Session = Depends(get_db)) -> ProductImportResult:
        content = await file.read()
        try:
            items = _parse_products_import_xlsx(content)
        except _ProductExcelImportError as e:
            raise HTTPException(status_code=400, detail="\n".join(e.errors)) from e
        except RuntimeError as e:
            raise HTTPException(status_code=501, detail=str(e)) from e

        existing_by_sku = {p.sku.upper(): p for p in db.scalars(select(Product)).all()}
        created = 0
        updated = 0
        for item in items:
            sku = item["sku"].strip()
            key = sku.upper()
            name = item["name"].strip()
            base_uom = item["base_uom"].strip() or "Pc"
            uom = item["uom"].strip() or "Pc"
            uom_multiplier = 12 if uom.lower() == "dozen" else 1
            is_active = bool(item["is_active"])

            product = existing_by_sku.get(key)
            if product is None:
                product = Product(
                    sku=sku,
                    name=name,
                    base_uom=base_uom,
                    uom=uom,
                    uom_multiplier=uom_multiplier,
                    is_active=is_active,
                    quantity_on_hand=0,
                    currency=settings.DEFAULT_CURRENCY,
                    unit_price=Decimal("0"),
                    cost_price=Decimal("0"),
                )
                db.add(product)
                existing_by_sku[key] = product
                created += 1
            else:
                product.name = name
                product.base_uom = base_uom
                product.uom = uom
                product.uom_multiplier = uom_multiplier
                product.is_active = is_active
                updated += 1

        db.commit()
        return ProductImportResult(created=created, updated=updated)
else:

    @router.post("/import", status_code=status.HTTP_501_NOT_IMPLEMENTED)
    async def import_products_xlsx_unavailable() -> None:
        raise HTTPException(
            status_code=501,
            detail='Missing dependency: python-multipart. Install with "pip install python-multipart".',
        )


@router.get("/{product_id}", response_model=ProductRead)
def get_product(product_id: int, db: Session = Depends(get_db)) -> Product:
    stmt = select(Product).where(Product.id == product_id).options(selectinload(Product.category))
    product = db.scalar(stmt)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.put("/{product_id}", response_model=ProductRead)
def update_product(product_id: int, product_in: ProductUpdate, db: Session = Depends(get_db)) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    data = product_in.model_dump(exclude_unset=True)
    if "category_id" in data and data["category_id"] is not None:
        cat = db.get(Category, data["category_id"])
        if cat is None:
            raise HTTPException(status_code=400, detail="Invalid category_id")
    if "currency" in data and data["currency"] is None:
        data["currency"] = settings.DEFAULT_CURRENCY
    if "base_uom" in data and data["base_uom"] is not None:
        data["base_uom"] = data["base_uom"].strip()
    if "base_uom" in data and data["base_uom"] is None:
        data["base_uom"] = "Pc"
    if "uom" in data and data["uom"] is not None:
        data["uom"] = data["uom"].strip()
    if "uom" in data and data["uom"] is None:
        data["uom"] = "Pc"
    if "uom" in data and "uom_multiplier" not in data:
        data["uom_multiplier"] = 12 if (data["uom"] or "").lower() == "dozen" else 1
    if "uom_multiplier" in data and data["uom_multiplier"] is None:
        uom = data.get("uom", product.uom)
        data["uom_multiplier"] = 12 if (uom or "").lower() == "dozen" else 1
    for key, value in data.items():
        setattr(product, key, value)
    db.commit()
    db.refresh(product)
    return product


@router.patch("/{product_id}", response_model=ProductRead)
def patch_product(product_id: int, product_in: ProductUpdate, db: Session = Depends(get_db)) -> Product:
    # Same semantics as PUT in this MVP: partial update via exclude_unset=True
    return update_product(product_id=product_id, product_in=product_in, db=db)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(product_id: int, db: Session = Depends(get_db)) -> None:
    product = db.get(Product, product_id)
    if product is None:
        return
    db.delete(product)
    db.commit()
