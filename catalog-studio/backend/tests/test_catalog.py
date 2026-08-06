from decimal import Decimal
import unittest

from app.catalog_render import CatalogRenderOptions, build_catalog_categories, get_catalog_company, paginate_catalog, render_catalog_pdf
from app.excel import build_template, parse_workbook
from app.main import app, slug_sku
from app.models import Category, Product


class CatalogStudioTests(unittest.TestCase):
    def test_sku_generation_removes_accents(self) -> None:
        self.assertEqual(slug_sku("Sản phẩm thử nghiệm"), "SAN_PHAM_THU_NGHIEM")

    def test_excel_template_can_be_read(self) -> None:
        rows = parse_workbook(build_template())
        self.assertEqual(rows[0]["name"], "Sea Salt Potato Chips")

    def test_pdf_uses_category_pagination(self) -> None:
        category = Category(id=1, name="Snacks", sort_order=1)
        products = []
        for index in range(13):
            product = Product(
                id=index + 1,
                sku=f"SKU-{index + 1}",
                name=f"Product {index + 1}",
                brand="ULINK",
                category_id=category.id,
                unit_size="5 oz",
                case_pack=12,
                wholesale_price=Decimal("8.50"),
                currency="USD",
                stock_qty=10,
                badges="",
                catalog_enabled=True,
                is_active=True,
                sort_order=index,
            )
            product.category = category
            products.append(product)
        categories = build_catalog_categories(products)
        self.assertEqual(len(paginate_catalog(categories)), 2)
        payload, warnings = render_catalog_pdf(
            company=get_catalog_company(title="Test Catalog", version="Test Edition"),
            categories=categories,
            options=CatalogRenderOptions(show_price=True),
        )
        self.assertTrue(payload.startswith(b"%PDF"))
        self.assertGreater(len(payload), 10_000)
        self.assertEqual(len(warnings), 13)

    def test_openapi_contains_core_routes(self) -> None:
        routes = app.openapi()["paths"]
        self.assertIn("/api/products-import", routes)
        self.assertIn("/api/catalog/pdf", routes)


if __name__ == "__main__":
    unittest.main()
