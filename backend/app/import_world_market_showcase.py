"""Import product-only FREE invoice lines from World Market summer 2026.

Run from backend root: python -m app.import_world_market_showcase --apply
Without --apply this performs a read-only validation and prints the plan.
This file deliberately does not copy invoice prices, quantities, or customer
identity into public content.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass

from sqlalchemy import select

from app.db.models import (
    Invoice, InvoiceLine, Product, ShowcaseItem, WebsiteCategory,
    WebsiteListing, WebsiteListingTranslation,
)
from app.db.session import SessionLocal


@dataclass(frozen=True)
class Entry:
    line_id: int
    category: str
    brand: str | None
    title_en: str
    title_vi: str | None = None


CATEGORIES = {
    "snacks": ("Đồ ăn vặt & trái cây sấy", "Snacks & dried fruit"),
    "tea": ("Trà & thảo mộc", "Tea & herbal drinks"),
    "beverages": ("Nước giải khát", "Beverages"),
    "noodles": ("Mì, bún & miến", "Noodles & vermicelli"),
    "pantry": ("Nguyên liệu khô", "Dry pantry goods"),
    "condiments": ("Gia vị & nước chấm", "Sauces & condiments"),
    "rice-paper": ("Bánh tráng & thực phẩm khô", "Rice paper & dry foods"),
    "instant-foods": ("Súp & món ăn liền", "Soups & instant foods"),
    "bakery-equipment": ("Thiết bị làm bánh", "Bakery equipment"),
    "food-processing-equipment": ("Thiết bị chế biến thực phẩm", "Food processing equipment"),
}

# Line IDs are stable in the ERP's invoices UL0044, UL0045, and UL0046.
# A single line describing several flavors stays one sourcing listing because
# the invoice does not identify separate packs or SKUs.
ENTRIES = [
    Entry(156, "bakery-equipment", None, "8 kg dough mixer"),
    Entry(157, "bakery-equipment", None, "Automatic dough divider and rounder"),
    Entry(158, "bakery-equipment", None, "6 roller dough moulder with dual conveyor"),
    Entry(159, "bakery-equipment", None, "30 tray dough proofer"),
    Entry(160, "bakery-equipment", None, "8 tray electric bread oven"),
    Entry(161, "bakery-equipment", None, "Loading ramp and wheel assembly"),
    Entry(162, "bakery-equipment", None, "5 wave baking tray, 46 × 72 cm"),
    Entry(164, "food-processing-equipment", None, "Vietnamese pork roll processing machine"),
    Entry(165, "food-processing-equipment", None, "Vietnamese pork roll steamer"),
    Entry(166, "food-processing-equipment", None, "Steaming tray"),
    Entry(167, "beverages", "Sting", "Sting Yellow, tall can"),
    Entry(168, "beverages", "Sting", "Sting Strawberry, tall can"),
    Entry(169, "beverages", "Sting", "Sting Green, tall can"),
    Entry(170, "beverages", "Warrior", "Warrior Strawberry"),
    Entry(171, "beverages", "Warrior", "Warrior Grape"),
    Entry(172, "beverages", "Tea Plus", "Tea Plus Oolong Tea"),
    Entry(173, "beverages", "Boncha", "Boncha Honey Tea, Kumquat and Blueberry"),
    Entry(174, "beverages", "C2", "C2 Tea, Lemon and Peach"),
    Entry(175, "beverages", None, "Winter Melon Tea"),
    Entry(176, "beverages", "0 Độ", "0 Degree Green Tea"),
    Entry(177, "beverages", None, "Energy drink (Bò húc)"),
    Entry(178, "beverages", "Trung Nguyên", "Trung Nguyên Milk Coffee"),
    Entry(179, "noodles", "Safaco", "Safaco Premium Vegetarian Noodles"),
    Entry(180, "noodles", "Safaco", "Safaco Fresh Rice Vermicelli"),
    Entry(181, "noodles", "Meizan", "Meizan Macaroni"),
    Entry(182, "noodles", "Safaco", "Safaco Large Macaroni"),
    Entry(183, "noodles", "Vifon", "Vifon Dried Crab Noodles"),
    Entry(184, "noodles", "Phú Hương", "Phú Hương Glass Noodles"),
    Entry(185, "noodles", "Safaco", "Safaco Rice Vermicelli"),
    Entry(186, "pantry", None, "Whole Mung Beans"),
    Entry(187, "pantry", None, "Split Hulled Mung Beans"),
    Entry(188, "pantry", None, "Black Beans"),
    Entry(189, "pantry", None, "Green-centered Black Beans"),
    Entry(190, "pantry", None, "Peanuts"),
    Entry(191, "condiments", "Cholimex", "Cholimex Chili Sauce"),
    Entry(192, "condiments", "CHIN-SU", "CHIN-SU Chili Sauce"),
    Entry(193, "pantry", "Kim Cương", "Kim Cương Rock Sugar"),
    Entry(194, "condiments", None, "White Peppercorns"),
    Entry(195, "condiments", "Hảo Hảo", "Hảo Hảo Dipping Salt"),
    Entry(196, "condiments", "CHIN-SU", "CHIN-SU Fish Sauce"),
    Entry(197, "condiments", "Thuận Phát", "Thuận Phát Fish Sauce"),
    Entry(198, "condiments", "Hưng Thịnh", "Hưng Thịnh Fish Sauce"),
    Entry(199, "rice-paper", None, "Bình Định Coconut Rice Paper"),
    Entry(200, "rice-paper", None, "Rice Paper for Rolls"),
    Entry(201, "rice-paper", None, "Sweet Potato Rice Paper"),
    Entry(202, "rice-paper", None, "Shrimp Rice Paper"),
    Entry(203, "rice-paper", None, "Fried Shallots"),
    Entry(205, "instant-foods", None, "Seafood Soup, 14 g × 30"),
    Entry(206, "instant-foods", None, "Snow Fungus and Black Moss Soup, 14 g × 30"),
    Entry(207, "instant-foods", None, "Salmon Oat Soup, 23 g × 30"),
    Entry(208, "instant-foods", None, "Salmon Oat Soup, 69 g × 15"),
    Entry(209, "instant-foods", None, "Seafood Soup, 42 g × 15"),
    Entry(210, "instant-foods", None, "Peach Orange Lemongrass Tea, 120 g × 15"),
    Entry(211, "instant-foods", None, "Longan Snow Fungus Chia Drink, 27 g × 24"),
    Entry(212, "instant-foods", None, "Longan Snow Fungus Chia Drink, 108 g × 15"),
    Entry(213, "instant-foods", None, "Vegetarian Sour Soup, 50 g × 20"),
    Entry(214, "instant-foods", None, "Sour Bamboo Shoot Mushroom Soup, 50 g × 20"),
    Entry(219, "packaging", None, 'Custom printed T-shirt bags, 12 × 7 × 21 in',
          "Túi xốp in thương hiệu 12 × 7 × 21 inch"),
    Entry(220, "packaging", None, 'Custom printed T-shirt bags, 12 × 7 × 22.5 in',
          "Túi xốp in thông điệp 12 × 7 × 22,5 inch"),
]

SOURCE_INVOICES = {"UL0044", "UL0045", "UL0046"}
SERVICE_LINE_IDS = {215, 216, 217, 218}
EXISTING_SHOWCASE_CODES = {157: "EQ-DOUGH-DIV", 160: "EQ-OVEN-008"}
SUMMARY_VI = "Sản phẩm được cung ứng theo yêu cầu. Liên hệ ULINK để xác nhận quy cách, số lượng tối thiểu và thời gian giao."
SUMMARY_EN = "Available for wholesale sourcing. Contact ULINK to confirm specifications, minimum order and lead time."


def main(apply: bool) -> None:
    with SessionLocal() as db:
        rows = db.execute(select(InvoiceLine, Invoice).join(Invoice, Invoice.id == InvoiceLine.invoice_id)
                          .where(Invoice.invoice_number.in_(SOURCE_INVOICES), InvoiceLine.line_type == "FREE")).all()
        source = {line.id: (line, invoice) for line, invoice in rows}
        expected = {entry.line_id for entry in ENTRIES} | SERVICE_LINE_IDS
        if len(ENTRIES) != 59 or len({entry.line_id for entry in ENTRIES}) != 59:
            raise RuntimeError("Expected 59 unique product lines")
        if set(source) != expected:
            raise RuntimeError(f"Invoice lines changed: missing={expected-set(source)}, new={set(source)-expected}")
        for entry in ENTRIES:
            line, invoice = source[entry.line_id]
            if line.product_id is not None or line.line_type != "FREE":
                raise RuntimeError(f"Line {line.id} is not an unlinked FREE item")
            if invoice.invoice_number not in SOURCE_INVOICES or invoice.status == "VOID":
                raise RuntimeError(f"Source invoice invalid for line {line.id}")
        print("Validated 59 goods, 4 service lines excluded; source invoices UL0044/45/46")
        if not apply:
            for entry in ENTRIES:
                line, invoice = source[entry.line_id]
                print(invoice.invoice_number, line.id, entry.category, entry.brand or "-", line.product_name)
            return

        categories = {}
        next_order = 6
        for slug, (vi, en) in CATEGORIES.items():
            category = db.scalar(select(WebsiteCategory).where(
                WebsiteCategory.site == "ulink", WebsiteCategory.slug == slug))
            if category is None:
                category = WebsiteCategory(site="ulink", slug=slug, name_vi=vi, name_en=en,
                                           sort_order=next_order, is_active=True)
                db.add(category)
                db.flush()
            categories[slug] = category
            next_order += 1
        categories["packaging"] = db.scalar(select(WebsiteCategory).where(
            WebsiteCategory.site == "ulink", WebsiteCategory.slug == "packaging"))
        if categories["packaging"] is None:
            raise RuntimeError("Existing packaging category missing")

        created = 0
        for entry in ENTRIES:
            line, invoice = source[entry.line_id]
            if entry.line_id in EXISTING_SHOWCASE_CODES:
                existing = db.scalar(select(ShowcaseItem).where(
                    ShowcaseItem.code == EXISTING_SHOWCASE_CODES[entry.line_id]))
                if existing is None:
                    raise RuntimeError(f"Existing Showcase missing for line {entry.line_id}")
                continue
            code = f"SC-{invoice.invoice_number}-{line.id}"
            item = db.scalar(select(ShowcaseItem).where(ShowcaseItem.code == code))
            if item is None:
                item = ShowcaseItem(
                    code=code, name=line.product_name, category=CATEGORIES.get(entry.category, ("Bao bì", "Packaging"))[1],
                    category_slug=entry.category, description=SUMMARY_VI,
                    highlights=json.dumps([], ensure_ascii=False),
                    specifications=json.dumps({}, ensure_ascii=False),
                    images=json.dumps([]), image_url=None, brand=entry.brand or "",
                    min_order_quantity=1, lead_time=None,
                    badges=json.dumps([]),
                    sort_order=1000 + entry.line_id, is_active=True,
                )
                db.add(item)
                db.flush()
                created += 1
            listing = db.scalar(select(WebsiteListing).where(
                WebsiteListing.site == "ulink", WebsiteListing.showcase_id == item.id))
            if listing is None:
                listing = WebsiteListing(site="ulink", showcase_id=item.id,
                    category_id=categories[entry.category].id,
                    is_published=True, sort_order=item.sort_order)
                db.add(listing)
                db.flush()
                vi_title = entry.title_vi or line.product_name
                for locale, title, summary in (
                    ("vi", vi_title, SUMMARY_VI), ("en", entry.title_en, SUMMARY_EN),
                ):
                    db.add(WebsiteListingTranslation(
                        listing_id=listing.id, locale=locale, title=title,
                        summary=summary, description=summary,
                        seo_title=title,
                        seo_description=summary,
                    ))

            # Correct only the initial import defaults; preserve later admin edits.
            if item.lead_time == "Confirm with ULINK":
                item.lead_time = None
            if item.badges == json.dumps(["ORDER ON REQUEST"]):
                item.badges = json.dumps([])
            for translation in db.scalars(select(WebsiteListingTranslation).where(
                WebsiteListingTranslation.listing_id == listing.id,
            )):
                if translation.seo_title == f"{translation.title} | ULINK Wholesale":
                    translation.seo_title = translation.title

        # Keep the public product-type filter coherent with the new divisions.
        grocery_listings = db.scalars(select(WebsiteListing).where(
            WebsiteListing.site == "ulink", WebsiteListing.product_id.is_not(None))).all()
        remapped = 0
        for listing in grocery_listings:
            product = db.get(Product, listing.product_id)
            if product is None or product.business_unit != "GROCERY":
                continue
            slug = "tea" if product.name.casefold().startswith("trà ") else "snacks"
            if listing.category_id != categories[slug].id:
                listing.category_id = categories[slug].id
                remapped += 1

        existing_showcases = db.scalars(select(ShowcaseItem).where(
            ShowcaseItem.code.in_(("EQ-OVEN-008", "EQ-DOUGH-DIV", "FOD-FISH-SAUCE")))).all()
        for item in existing_showcases:
            listing = db.scalar(select(WebsiteListing).where(
                WebsiteListing.site == "ulink", WebsiteListing.showcase_id == item.id))
            if listing:
                slug = "condiments" if item.code == "FOD-FISH-SAUCE" else "bakery-equipment"
                listing.category_id = categories[slug].id
        db.commit()
        print(f"Created {created} showcase items; reused 2 existing Showcase items; remapped {remapped} inventory food listings")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    main(parser.parse_args().apply)
