from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class CategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sort_order: int = 0


class CategoryCreate(CategoryBase):
    pass


class CategoryRead(CategoryBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class ProductBase(BaseModel):
    sku: str = ""
    name: str = Field(min_length=1, max_length=240)
    brand: str = ""
    category_id: int | None = None
    image_url: str | None = None
    unit_size: str = ""
    case_pack: int | None = Field(default=None, ge=1)
    country_of_origin: str = ""
    upc: str = ""
    wholesale_price: Decimal = Field(default=Decimal("0"), ge=0)
    currency: str = "USD"
    stock_qty: int = 0
    badges: str = ""
    catalog_enabled: bool = True
    is_active: bool = True
    sort_order: int = 0


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    sku: str | None = None
    name: str | None = None
    brand: str | None = None
    category_id: int | None = None
    image_url: str | None = None
    unit_size: str | None = None
    case_pack: int | None = None
    country_of_origin: str | None = None
    upc: str | None = None
    wholesale_price: Decimal | None = None
    currency: str | None = None
    stock_qty: int | None = None
    badges: str | None = None
    catalog_enabled: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class ProductRead(ProductBase):
    id: int
    category_name: str = "Uncategorized"
    model_config = ConfigDict(from_attributes=True)


class ImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[str]
