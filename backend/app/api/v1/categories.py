from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import Category
from app.schemas.category import CategoryCreate, CategoryRead, CategoryUpdate


router = APIRouter(prefix="/categories")


@router.get("", response_model=list[CategoryRead])
def list_categories(skip: int = 0, limit: int = 200, db: Session = Depends(get_db)) -> list[Category]:
    stmt = select(Category).order_by(Category.name.asc()).offset(skip).limit(limit)
    return db.scalars(stmt).all()


@router.post("", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(body: CategoryCreate, db: Session = Depends(get_db)) -> Category:
    existing = db.scalar(select(Category).where(Category.name == body.name))
    if existing is not None:
        raise HTTPException(status_code=409, detail="Category name already exists")
    cat = Category(name=body.name.strip(), description=body.description)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.get("/{category_id}", response_model=CategoryRead)
def get_category(category_id: int, db: Session = Depends(get_db)) -> Category:
    cat = db.get(Category, category_id)
    if cat is None:
        raise HTTPException(status_code=404, detail="Category not found")
    return cat


@router.put("/{category_id}", response_model=CategoryRead)
def update_category(category_id: int, body: CategoryUpdate, db: Session = Depends(get_db)) -> Category:
    cat = db.get(Category, category_id)
    if cat is None:
        raise HTTPException(status_code=404, detail="Category not found")

    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        name = data["name"].strip()
        if not name:
            raise HTTPException(status_code=400, detail="name must not be empty")
        existing = db.scalar(select(Category).where(Category.name == name, Category.id != cat.id))
        if existing is not None:
            raise HTTPException(status_code=409, detail="Category name already exists")
        cat.name = name
    if "description" in data:
        cat.description = data["description"]

    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db)) -> None:
    cat = db.get(Category, category_id)
    if cat is None:
        return
    db.delete(cat)
    db.commit()

