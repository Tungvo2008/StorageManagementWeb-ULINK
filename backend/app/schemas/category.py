from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    catalog_sort_order: int = Field(default=0, ge=0, le=1000000)


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    catalog_sort_order: int | None = Field(default=None, ge=0, le=1000000)


class CategoryRead(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
