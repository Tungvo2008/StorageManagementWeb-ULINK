from __future__ import annotations

from io import BytesIO
from pathlib import Path
import re
import unicodedata
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, Query, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.catalog_render import (
    CatalogRenderOptions,
    build_catalog_categories,
    get_catalog_company,
    missing_image_skus,
    paginate_catalog,
    render_catalog_pdf,
)
from app.config import BASE_DIR, settings
from app.db import Base, engine, get_db
from app.excel import boolean, build_template, decimal, integer, parse_workbook, text
from app.models import Category, Product
from app.schemas import CategoryCreate, CategoryRead, ImportResult, ProductCreate, ProductRead, ProductUpdate


configured_upload_dir = Path(settings.UPLOAD_DIR).expanduser()
UPLOAD_DIR = configured_upload_dir if configured_upload_dir.is_absolute() else BASE_DIR / configured_upload_dir
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

app = FastAPI(title="Ulink Catalog Studio API", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)


UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


def product_payload(product: Product) -> ProductRead:
    data = ProductRead.model_validate(product).model_dump()
    data["category_name"] = product.category.name if product.category else "Uncategorized"
    return ProductRead(**data)


def slug_sku(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii").upper()
    return re.sub(r"_+", "_", re.sub(r"[^A-Z0-9]+", "_", ascii_value)).strip("_")[:80] or "PRODUCT"


def unique_sku(db: Session, preferred: str, current_id: int | None = None) -> str:
    base = slug_sku(preferred)
    candidate = base
    suffix = 2
    while True:
        found = db.scalar(select(Product).where(Product.sku == candidate))
        if found is None or found.id == current_id:
            return candidate
        tail = f"_{suffix}"
        candidate = f"{base[:80 - len(tail)]}{tail}"
        suffix += 1


def category_for_name(db: Session, name: str, *, create: bool) -> Category | None:
    normalized = name.strip()
    if not normalized:
        return None
    category = db.scalar(select(Category).where(Category.name == normalized))
    if category is None and create:
        category = Category(name=normalized)
        db.add(category)
        db.flush()
    return category


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": "Ulink Catalog Studio", "version": app.version}


@app.get("/api/categories", response_model=list[CategoryRead])
def list_categories(db: Session = Depends(get_db)):
    return db.scalars(select(Category).order_by(Category.sort_order, Category.name)).all()


@app.post("/api/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)):
    if db.scalar(select(Category).where(Category.name == payload.name.strip())):
        raise HTTPException(status_code=409, detail="Category already exists")
    category = Category(name=payload.name.strip(), sort_order=payload.sort_order)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@app.put("/api/categories/{category_id}", response_model=CategoryRead)
def update_category(category_id: int, payload: CategoryCreate, db: Session = Depends(get_db)):
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    duplicate = db.scalar(select(Category).where(Category.name == payload.name.strip(), Category.id != category_id))
    if duplicate:
        raise HTTPException(status_code=409, detail="Category already exists")
    category.name = payload.name.strip()
    category.sort_order = payload.sort_order
    db.commit()
    db.refresh(category)
    return category


@app.delete("/api/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db)):
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    for product in category.products:
        product.category_id = None
    db.delete(category)
    db.commit()
    return Response(status_code=204)


@app.get("/api/products", response_model=list[ProductRead])
def list_products(db: Session = Depends(get_db)):
    products = db.scalars(
        select(Product).options(selectinload(Product.category)).order_by(Product.sort_order, Product.name)
    ).all()
    return [product_payload(product) for product in products]


@app.post("/api/products", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(payload: ProductCreate, db: Session = Depends(get_db)):
    values = payload.model_dump()
    values["sku"] = unique_sku(db, payload.sku or payload.name)
    if payload.category_id and db.get(Category, payload.category_id) is None:
        raise HTTPException(status_code=400, detail="Category not found")
    product = Product(**values)
    db.add(product)
    db.commit()
    db.refresh(product)
    product = db.scalar(select(Product).options(selectinload(Product.category)).where(Product.id == product.id))
    return product_payload(product)


@app.put("/api/products/{product_id}", response_model=ProductRead)
def update_product(product_id: int, payload: ProductUpdate, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    values = payload.model_dump(exclude_unset=True)
    if "sku" in values:
        values["sku"] = unique_sku(db, values["sku"] or values.get("name") or product.name, product.id)
    if values.get("category_id") and db.get(Category, values["category_id"]) is None:
        raise HTTPException(status_code=400, detail="Category not found")
    for key, value in values.items():
        setattr(product, key, value)
    db.commit()
    product = db.scalar(select(Product).options(selectinload(Product.category)).where(Product.id == product.id))
    return product_payload(product)


@app.delete("/api/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(product_id: int, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.image_url and product.image_url.startswith("/uploads/"):
        image_path = UPLOAD_DIR / Path(product.image_url).name
        image_path.unlink(missing_ok=True)
    db.delete(product)
    db.commit()
    return Response(status_code=204)


@app.post("/api/products/{product_id}/image", response_model=ProductRead)
async def upload_image(product_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    suffix = ALLOWED_IMAGE_TYPES.get(file.content_type or "")
    if suffix is None:
        raise HTTPException(status_code=400, detail="Use JPG, PNG, or WEBP")
    payload = await file.read(MAX_IMAGE_BYTES + 1)
    if not payload:
        raise HTTPException(status_code=400, detail="Image is empty")
    if len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 10 MB or smaller")
    try:
        from PIL import Image
        with Image.open(BytesIO(payload)) as image:
            image.verify()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    old_path = UPLOAD_DIR / Path(product.image_url).name if product.image_url and product.image_url.startswith("/uploads/") else None
    filename = f"{product.id}-{uuid4().hex}{suffix}"
    (UPLOAD_DIR / filename).write_bytes(payload)
    if old_path:
        old_path.unlink(missing_ok=True)
    product.image_url = f"/uploads/{filename}"
    db.commit()
    product = db.scalar(select(Product).options(selectinload(Product.category)).where(Product.id == product.id))
    return product_payload(product)


@app.get("/api/products-template.xlsx")
def products_template() -> Response:
    return Response(
        build_template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="catalog-products-template.xlsx"'},
    )


@app.post("/api/products-import", response_model=ImportResult)
async def import_products(file: UploadFile = File(...), db: Session = Depends(get_db)):
    try:
        rows = parse_workbook(await file.read())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    created = updated = skipped = 0
    errors: list[str] = []
    for row in rows:
        row_number = row.pop("_row")
        try:
            with db.begin_nested():
                name = text(row.get("name"))
                if not name:
                    raise ValueError("name is required")
                explicit_sku = text(row.get("sku"))
                existing = db.scalar(select(Product).where(Product.sku == explicit_sku)) if explicit_sku else None
                category_name = text(row.get("category"))
                category = category_for_name(db, category_name, create=True)
                values = {
                    "name": name,
                    "brand": text(row.get("brand")),
                    "category_id": category.id if category else None,
                    "unit_size": text(row.get("unit_size")),
                    "case_pack": integer(row.get("case_pack"), 0) or None,
                    "wholesale_price": decimal(row.get("wholesale_price")),
                    "currency": text(row.get("currency")) or "USD",
                    "country_of_origin": text(row.get("country_of_origin")),
                    "upc": text(row.get("upc")),
                    "stock_qty": integer(row.get("stock_qty")),
                    "badges": text(row.get("badges")),
                    "catalog_enabled": boolean(row.get("catalog_enabled")),
                    "is_active": boolean(row.get("is_active")),
                    "sort_order": integer(row.get("sort_order")),
                }
                if existing:
                    for key, value in values.items():
                        setattr(existing, key, value)
                    updated += 1
                else:
                    sku = unique_sku(db, explicit_sku or name)
                    db.add(Product(sku=sku, **values))
                    db.flush()
                    created += 1
        except Exception as exc:
            errors.append(f"Row {row_number}: {exc}")
            skipped += 1
    db.commit()
    return ImportResult(created=created, updated=updated, skipped=skipped, errors=errors)


def filtered_products(db: Session, category_ids: str, skus: str, availability: str):
    products = db.scalars(select(Product).options(selectinload(Product.category))).all()
    selected_categories = {int(value) for value in category_ids.split(",") if value.strip().isdigit()}
    selected_skus = {value.strip().casefold() for value in skus.split(",") if value.strip()}
    return [
        product
        for product in products
        if product.catalog_enabled
        and product.is_active
        and (not selected_categories or product.category_id in selected_categories)
        and (not selected_skus or product.sku.casefold() in selected_skus)
        and (availability == "all" or (availability == "in_stock") == (product.stock_qty > 0))
    ]


@app.get("/api/catalog/data")
def catalog_data(
    category_ids: str = "",
    skus: str = "",
    availability: str = "all",
    title: str = "",
    version: str = "",
    db: Session = Depends(get_db),
):
    products = filtered_products(db, category_ids, skus, availability)
    categories = build_catalog_categories(products)
    company = get_catalog_company(title=title, version=version)
    return {
        "catalog": company.__dict__,
        "categories": [
            {"id": category.id, "name": category.name, "products": [product.__dict__ for product in category.products]}
            for category in categories
        ],
        "product_count": len(products),
        "page_count": len(paginate_catalog(categories)),
        "missing_image_skus": missing_image_skus(categories),
    }


@app.get("/api/catalog/pdf")
def catalog_pdf(
    category_ids: str = "",
    skus: str = "",
    availability: str = "all",
    title: str = "",
    version: str = "",
    show_price: bool = False,
    show_country_of_origin: bool = False,
    show_upc: bool = False,
    show_badges: bool = True,
    show_availability: bool = False,
    disposition: str = Query(default="attachment", pattern="^(attachment|inline)$"),
    db: Session = Depends(get_db),
):
    categories = build_catalog_categories(filtered_products(db, category_ids, skus, availability))
    if not categories:
        raise HTTPException(status_code=400, detail="Select at least one catalog product")
    pdf, warnings = render_catalog_pdf(
        company=get_catalog_company(title=title, version=version),
        categories=categories,
        options=CatalogRenderOptions(show_price, show_country_of_origin, show_upc, show_badges, show_availability),
    )
    return Response(
        pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="ULINK Product Catalog.pdf"',
            "X-Missing-Images": str(len(warnings)),
        },
    )
