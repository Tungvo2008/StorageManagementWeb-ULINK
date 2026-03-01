from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import Customer
from app.schemas.customer import CustomerCreate, CustomerRead, CustomerUpdate


router = APIRouter(prefix="/customers")


@router.get("", response_model=list[CustomerRead])
def list_customers(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> list[Customer]:
    return db.scalars(select(Customer).offset(skip).limit(limit)).all()


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
    # Same semantics as PUT in this MVP: partial update via exclude_unset=True
    return update_customer(customer_id=customer_id, customer_in=customer_in, db=db)


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer(customer_id: int, db: Session = Depends(get_db)) -> None:
    customer = db.get(Customer, customer_id)
    if customer is None:
        return
    db.delete(customer)
    db.commit()
