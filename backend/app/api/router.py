from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.api.v1.auth import router as auth_router
from app.api.v1.categories import router as categories_router
from app.api.v1.health import router as health_router
from app.api.v1.customers import router as customers_router
from app.api.v1.inventory import router as inventory_router
from app.api.v1.invoices import router as invoices_router
from app.api.v1.products import router as products_router
from app.api.v1.sales import router as sales_router
from app.api.v1.users import router as users_router


api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(auth_router, tags=["auth"])

auth_deps = [Depends(get_current_user)]
api_router.include_router(categories_router, tags=["categories"], dependencies=auth_deps)
api_router.include_router(products_router, tags=["products"], dependencies=auth_deps)
api_router.include_router(customers_router, tags=["customers"], dependencies=auth_deps)
api_router.include_router(inventory_router, tags=["inventory"], dependencies=auth_deps)
api_router.include_router(sales_router, tags=["sales"], dependencies=auth_deps)
api_router.include_router(invoices_router, tags=["invoices"], dependencies=auth_deps)
api_router.include_router(users_router, tags=["users"], dependencies=auth_deps)
