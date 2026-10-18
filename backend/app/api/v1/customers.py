from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import Customer
from app.schemas.customer import CustomerCreate, CustomerRead, CustomerUpdate


router = APIRouter(prefix="/customers")


@router.get("", response_model=list[CustomerRead])
def list_customers(
    skip: int = 0,
    limit: int = 100,
    search: str | None = Query(None),
    db: Session = Depends(get_db),
) -> list[Customer]:
    stmt = select(Customer)
    if search:
        s = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Customer.name.ilike(s),
                Customer.phone.ilike(s),
                Customer.email.ilike(s),
                Customer.address.ilike(s),
                Customer.city.ilike(s),
            )
        )
    stmt = stmt.order_by(Customer.id.desc()).offset(skip).limit(limit)
    return db.scalars(stmt).all()


@router.post("", response_model=CustomerRead, status_code=status.HTTP_201_CREATED)
def create_customer(customer_in: CustomerCreate, db: Session = Depends(get_db)) -> Customer:
    customer = Customer(
        name=customer_in.name,
        email=customer_in.email,
        phone=customer_in.phone,
        address=customer_in.address,
        city=customer_in.city,
        zip_code=customer_in.zip_code,
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.get("/{customer_id}", response_model=CustomerRead)
def get_customer(customer_id: int, db: Session = Depends(get_db)) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@router.put("/{customer_id}", response_model=CustomerRead)
def update_customer(customer_id: int, customer_in: CustomerUpdate, db: Session = Depends(get_db)) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    for key, value in customer_in.model_dump(exclude_unset=True).items():
        setattr(customer, key, value)
    db.commit()
    db.refresh(customer)
    return customer


@router.patch("/{customer_id}", response_model=CustomerRead)
def patch_customer(customer_id: int, customer_in: CustomerUpdate, db: Session = Depends(get_db)) -> Customer:
    return update_customer(customer_id=customer_id, customer_in=customer_in, db=db)


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer(customer_id: int, db: Session = Depends(get_db)) -> None:
    customer = db.get(Customer, customer_id)
    if customer is None:
        return
    db.delete(customer)
    db.commit()

from decimal import Decimal
from app.db.models import CustomerProductPrice, Product, Category
from app.schemas.customer import CustomerPriceItem, CustomerPriceUpdate, CustomerPriceBulkUpdate
from app.core.config import settings
from datetime import datetime, timezone

def _utcnow():
    return datetime.now(timezone.utc)

@router.get("/{customer_id}/prices", response_model=list[CustomerPriceItem])
def get_customer_prices(customer_id: int, db: Session = Depends(get_db)) -> list[CustomerPriceItem]:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Get all active products
    products = db.scalars(
        select(Product).where(Product.is_active == True).order_by(Product.name.asc())
    ).all()

    # Get all custom prices for this customer
    custom_prices = db.scalars(
        select(CustomerProductPrice).where(CustomerProductPrice.customer_id == customer_id)
    ).all()
    cp_by_prod = {cp.product_id: cp for cp in custom_prices}

    res: list[CustomerPriceItem] = []
    for p in products:
        cp = cp_by_prod.get(p.id)
        def_p = Decimal(str(p.unit_price or 0))
        cust_p = Decimal(str(cp.price)) if cp else None
        eff_p = cust_p if cust_p is not None else def_p
        
        cat_name = p.category.name if p.category else None

        res.append(
            CustomerPriceItem(
                product_id=p.id,
                sku=p.sku,
                product_name=p.name,
                product_image_url=p.image_url,
                category_name=cat_name,
                default_price=def_p,
                custom_price=cust_p,
                effective_price=eff_p,
                last_sold_at=cp.last_sold_at if cp else None,
                last_invoice_number=cp.last_invoice_number if cp else None,
                notes=cp.notes if cp else None,
            )
        )
    return res


@router.put("/{customer_id}/prices/{product_id}", response_model=CustomerPriceItem)
def set_customer_product_price(
    customer_id: int,
    product_id: int,
    body: CustomerPriceUpdate,
    db: Session = Depends(get_db),
) -> CustomerPriceItem:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    cp = db.scalar(
        select(CustomerProductPrice).where(
            CustomerProductPrice.customer_id == customer_id,
            CustomerProductPrice.product_id == product_id,
        )
    )

    if body.price <= 0:
        if cp:
            db.delete(cp)
            db.commit()
        cust_p = None
        eff_p = Decimal(str(product.unit_price or 0))
        last_sold = None
        last_inv = None
        notes = None
    else:
        if not cp:
            cp = CustomerProductPrice(
                customer_id=customer_id,
                product_id=product_id,
                price=body.price,
                notes=body.notes,
                last_sold_at=_utcnow(),
            )
            db.add(cp)
        else:
            cp.price = body.price
            if body.notes is not None:
                cp.notes = body.notes
            cp.updated_at = _utcnow()
        db.commit()
        db.refresh(cp)
        cust_p = cp.price
        eff_p = cp.price
        last_sold = cp.last_sold_at
        last_inv = cp.last_invoice_number
        notes = cp.notes

    return CustomerPriceItem(
        product_id=product.id,
        sku=product.sku,
        product_name=product.name,
        product_image_url=product.image_url,
        category_name=product.category.name if product.category else None,
        default_price=Decimal(str(product.unit_price or 0)),
        custom_price=cust_p,
        effective_price=eff_p,
        last_sold_at=last_sold,
        last_invoice_number=last_inv,
        notes=notes,
    )
