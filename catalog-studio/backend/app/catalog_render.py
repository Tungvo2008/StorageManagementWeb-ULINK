from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
import io
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from app.config import settings
from app.models import Product


PRODUCTS_PER_PAGE = 12
configured_image_dir = Path(settings.UPLOAD_DIR).expanduser()
CATALOG_IMAGE_DIR = (
    configured_image_dir
    if configured_image_dir.is_absolute()
    else Path(__file__).resolve().parents[1] / configured_image_dir
)
CATALOG_LOGO_FALLBACK = Path(__file__).resolve().parents[1] / "assets" / "logo.png"
PUBLIC_IMAGE_PREFIX = "/uploads/"


@dataclass(frozen=True)
class CatalogCompany:
    title: str
    version: str
    company_name: str
    logo_url: str
    website: str
    email: str
    phone: str
    brand_color: str


@dataclass(frozen=True)
class CatalogProduct:
    id: int
    category_id: int | None
    category_name: str
    sku: str
    brand: str
    product_name: str
    catalog_short_name: str
    image_url: str | None
    unit_size: str
    case_pack: int | None
    country_of_origin: str
    upc: str
    wholesale_price: Decimal
    currency: str
    availability: str
    badges: tuple[str, ...]
    sort_order: int


@dataclass(frozen=True)
class CatalogCategory:
    id: int | None
    name: str
    sort_order: int
    products: tuple[CatalogProduct, ...]


@dataclass(frozen=True)
class CatalogPage:
    category_name: str
    products: tuple[CatalogProduct, ...]


@dataclass(frozen=True)
class CatalogRenderOptions:
    show_price: bool = False
    show_country_of_origin: bool = False
    show_upc: bool = False
    show_badges: bool = True
    show_availability: bool = False


def get_catalog_company(*, title: str = "", version: str = "") -> CatalogCompany:
    company_name = settings.COMPANY_NAME.strip()
    if not company_name or company_name.lower() == "my company":
        company_name = "ULINK LLC"
    catalog_version = version.strip()
    if not catalog_version:
        catalog_version = datetime.now().strftime("%B %Y")
    logo_path = _resolve_logo_path()
    return CatalogCompany(
        title=(title or "Wholesale Product Catalog").strip(),
        version=catalog_version,
        company_name=company_name,
        logo_url=str(logo_path) if logo_path else "",
        website=settings.COMPANY_WEBSITE.strip(),
        email=settings.COMPANY_EMAIL.strip(),
        phone=settings.COMPANY_PHONE.strip(),
        brand_color=settings.BRAND_COLOR.strip(),
    )


def normalize_catalog_product(product: Product) -> CatalogProduct:
    category = product.category
    category_name = category.name if category else "Uncategorized"
    badges = tuple(
        value.strip()
        for value in (product.badges or "").split(",")
        if value.strip()
    )
    case_pack = product.case_pack
    return CatalogProduct(
        id=product.id,
        category_id=product.category_id,
        category_name=category_name,
        sku=product.sku,
        brand=(product.brand or "").strip(),
        product_name=product.name,
        catalog_short_name=product.name.strip(),
        image_url=product.image_url,
        unit_size=product.unit_size.strip(),
        case_pack=case_pack,
        country_of_origin=(product.country_of_origin or "").strip(),
        upc=(product.upc or "").strip(),
        wholesale_price=Decimal(product.wholesale_price or 0),
        currency=(product.currency or "USD").upper(),
        availability="in_stock" if int(product.stock_qty or 0) > 0 else "out_of_stock",
        badges=badges,
        sort_order=int(product.sort_order or 0),
    )


def build_catalog_categories(products: Iterable[Product]) -> tuple[CatalogCategory, ...]:
    grouped: dict[tuple[int | None, str, int], list[CatalogProduct]] = {}
    for product in products:
        normalized = normalize_catalog_product(product)
        category_order = int(product.category.sort_order or 0) if product.category else 999999
        key = (normalized.category_id, normalized.category_name, category_order)
        grouped.setdefault(key, []).append(normalized)

    categories: list[CatalogCategory] = []
    for (category_id, category_name, category_order), category_products in grouped.items():
        category_products.sort(
            key=lambda item: (
                item.sort_order,
                item.brand.casefold(),
                item.sku.casefold(),
            )
        )
        categories.append(
            CatalogCategory(
                id=category_id,
                name=category_name,
                sort_order=category_order,
                products=tuple(category_products),
            )
        )
    categories.sort(key=lambda item: (item.sort_order, item.name.casefold()))
    return tuple(categories)


def paginate_catalog(categories: Iterable[CatalogCategory]) -> tuple[CatalogPage, ...]:
    pages: list[CatalogPage] = []
    for category in categories:
        products = list(category.products)
        for index in range(0, len(products), PRODUCTS_PER_PAGE):
            pages.append(
                CatalogPage(
                    category_name=category.name,
                    products=tuple(products[index : index + PRODUCTS_PER_PAGE]),
                )
            )
    return tuple(pages)


def resolve_product_image_path(image_url: str | None) -> Path | None:
    value = (image_url or "").strip()
    if not value:
        return None
    for prefix in (PUBLIC_IMAGE_PREFIX,):
        if value.startswith(prefix):
            candidate = CATALOG_IMAGE_DIR / Path(value.removeprefix(prefix)).name
            return candidate if candidate.is_file() else None
    candidate = Path(value).expanduser()
    if candidate.is_file():
        return candidate
    return None


def missing_image_skus(categories: Iterable[CatalogCategory]) -> list[str]:
    missing: list[str] = []
    for category in categories:
        for product in category.products:
            if resolve_product_image_path(product.image_url) is None and not _is_remote_image(product.image_url):
                missing.append(product.sku)
    return missing


def render_catalog_pdf(
    *,
    company: CatalogCompany,
    categories: Iterable[CatalogCategory],
    options: CatalogRenderOptions,
) -> tuple[bytes, list[str]]:
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import inch
        from reportlab.lib.utils import ImageReader
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.pdfgen import canvas
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("reportlab is required for catalog PDF export") from exc

    pages = paginate_catalog(categories)
    if not pages:
        raise ValueError("No products match the selected catalog filters")

    output = io.BytesIO()
    pdf = canvas.Canvas(output, pagesize=letter)
    pdf.setTitle(company.title)
    pdf.setAuthor(company.company_name)
    pdf.setSubject("Ulink LLC wholesale product catalog")
    page_width, page_height = letter
    regular_font, bold_font = _register_fonts(pdfmetrics, TTFont)
    brand_color = _safe_color(colors, company.brand_color)
    border_color = colors.HexColor("#D7DCE3")
    muted_color = colors.HexColor("#667085")
    light_fill = colors.HexColor("#F8FAFC")
    warning_skus: list[str] = []

    margin_x = 0.36 * inch
    header_top = page_height - 0.28 * inch
    header_bottom = page_height - 1.13 * inch
    footer_top = 0.43 * inch
    grid_top = header_bottom - 0.08 * inch
    grid_bottom = footer_top + 0.08 * inch
    column_gap = 0.08 * inch
    row_gap = 0.09 * inch
    card_width = (page_width - (2 * margin_x) - (3 * column_gap)) / 4
    card_height = (grid_top - grid_bottom - (2 * row_gap)) / 3

    logo_reader = _load_image_reader(
        company.logo_url,
        ImageReader=ImageReader,
        max_bytes=4 * 1024 * 1024,
    )

    def set_font(size: float, *, bold: bool = False) -> None:
        pdf.setFont(bold_font if bold else regular_font, size)

    def draw_header(page: CatalogPage) -> None:
        logo_x = margin_x
        logo_y = header_top - 0.56 * inch
        logo_w = 1.48 * inch
        logo_h = 0.52 * inch
        if logo_reader is not None:
            _draw_contained_image(
                pdf,
                logo_reader,
                logo_x,
                logo_y,
                logo_w,
                logo_h,
            )
        else:
            set_font(22, bold=True)
            pdf.setFillColor(brand_color)
            pdf.drawString(logo_x, header_top - 0.34 * inch, company.company_name)

        text_x = margin_x + 1.68 * inch
        pdf.setFillColor(colors.black)
        set_font(17, bold=True)
        pdf.drawString(text_x, header_top - 0.12 * inch, _ellipsis(pdf, company.title.upper(), bold_font, 17, 4.9 * inch))
        pdf.setFillColor(brand_color)
        set_font(13.5, bold=True)
        pdf.drawString(
            text_x,
            header_top - 0.38 * inch,
            _ellipsis(pdf, page.category_name, bold_font, 13.5, 4.9 * inch),
        )
        pdf.setFillColor(muted_color)
        set_font(8.5)
        pdf.drawString(text_x, header_top - 0.59 * inch, company.version)
        pdf.setStrokeColor(brand_color)
        pdf.setLineWidth(1.3)
        pdf.line(margin_x, header_bottom, page_width - margin_x, header_bottom)

    def draw_footer(page_number: int, total_pages: int) -> None:
        pdf.setStrokeColor(brand_color)
        pdf.setLineWidth(1.1)
        pdf.line(margin_x, footer_top, page_width - margin_x, footer_top)
        set_font(7.3)
        pdf.setFillColor(brand_color)
        footer_y = 0.22 * inch
        contact_values = [value for value in (company.website, company.email, company.phone) if value]
        slot_width = (page_width - 2 * margin_x - 1.0 * inch) / max(1, len(contact_values))
        for index, value in enumerate(contact_values):
            pdf.drawString(margin_x + index * slot_width, footer_y, value)
        set_font(7.5, bold=True)
        pdf.drawRightString(page_width - margin_x, footer_y, f"Page {page_number} of {total_pages}")

    def draw_card(product: CatalogProduct, x: float, y: float) -> None:
        pdf.setFillColor(colors.white)
        pdf.setStrokeColor(border_color)
        pdf.setLineWidth(0.55)
        pdf.roundRect(x, y, card_width, card_height, 3, fill=1, stroke=1)

        inner_x = x + 0.07 * inch
        inner_width = card_width - 0.14 * inch
        image_size = min(inner_width, 1.42 * inch)
        image_x = x + (card_width - image_size) / 2
        image_y = y + card_height - image_size - 0.06 * inch

        pdf.setFillColor(light_fill)
        pdf.setStrokeColor(colors.HexColor("#EEF1F4"))
        pdf.roundRect(image_x, image_y, image_size, image_size, 3, fill=1, stroke=1)

        image_reader = _load_product_image(product.image_url, ImageReader=ImageReader)
        if image_reader is not None:
            _draw_contained_image(
                pdf,
                image_reader,
                image_x + 4,
                image_y + 4,
                image_size - 8,
                image_size - 8,
            )
        else:
            warning_skus.append(product.sku)
            pdf.setFillColor(muted_color)
            set_font(7)
            pdf.drawCentredString(image_x + image_size / 2, image_y + image_size / 2, "Image unavailable")

        if options.show_badges and product.badges:
            badge_text = product.badges[0].upper()
            badge_width = min(0.62 * inch, max(0.35 * inch, pdf.stringWidth(badge_text, bold_font, 5.4) + 8))
            pdf.setFillColor(brand_color)
            pdf.roundRect(
                image_x + image_size - badge_width - 3,
                image_y + image_size - 13,
                badge_width,
                10,
                4,
                fill=1,
                stroke=0,
            )
            pdf.setFillColor(colors.white)
            set_font(5.4, bold=True)
            pdf.drawCentredString(
                image_x + image_size - badge_width / 2 - 3,
                image_y + image_size - 10.2,
                _ellipsis(pdf, badge_text, bold_font, 5.4, badge_width - 5),
            )

        text_y = image_y - 0.10 * inch
        pdf.setFillColor(colors.black)
        set_font(6.6, bold=True)
        brand = product.brand or "ULINK"
        pdf.drawString(inner_x, text_y, _ellipsis(pdf, brand, bold_font, 6.6, inner_width))

        name_lines = _wrap_lines(
            pdf,
            product.catalog_short_name or product.product_name,
            regular_font,
            7.9,
            inner_width,
            max_lines=2,
        )
        set_font(7.9)
        name_y = text_y - 0.14 * inch
        for line_index in range(2):
            line = name_lines[line_index] if line_index < len(name_lines) else ""
            pdf.drawString(inner_x, name_y - line_index * 0.13 * inch, line)

        meta_y = name_y - 0.34 * inch
        label_font_size = 5.8
        metadata: list[tuple[str, str]] = [
            ("Size", product.unit_size),
            ("Case Pack", str(product.case_pack) if product.case_pack else ""),
        ]
        if options.show_price:
            metadata.append(("Price", _format_price(product.wholesale_price, product.currency)))
        if options.show_country_of_origin:
            metadata.append(("Origin", product.country_of_origin))
        if options.show_upc:
            metadata.append(("UPC", product.upc))
        if options.show_availability:
            metadata.append(("Availability", product.availability.replace("_", " ").title()))

        visible_metadata = [(label, value) for label, value in metadata if value][:7]
        for meta_index, (label, value) in enumerate(visible_metadata):
            current_y = meta_y - meta_index * 0.10 * inch
            set_font(label_font_size, bold=True)
            pdf.drawString(inner_x, current_y, f"{label}:")
            label_width = pdf.stringWidth(f"{label}: ", bold_font, label_font_size)
            set_font(label_font_size)
            pdf.drawString(
                inner_x + label_width,
                current_y,
                _ellipsis(
                    pdf,
                    value,
                    regular_font,
                    label_font_size,
                    inner_width - label_width,
                ),
            )

        if options.show_availability and product.availability == "out_of_stock":
            pdf.setFillColor(colors.HexColor("#B42318"))
            set_font(5.8, bold=True)
            pdf.drawRightString(x + card_width - 5, y + 5, "OUT OF STOCK")

    for page_index, page in enumerate(pages, start=1):
        draw_header(page)
        for slot_index in range(PRODUCTS_PER_PAGE):
            row = slot_index // 4
            column = slot_index % 4
            card_x = margin_x + column * (card_width + column_gap)
            card_y = grid_top - (row + 1) * card_height - row * row_gap
            if slot_index < len(page.products):
                draw_card(page.products[slot_index], card_x, card_y)
        draw_footer(page_index, len(pages))
        pdf.showPage()

    pdf.save()
    return output.getvalue(), sorted(set(warning_skus))


def _resolve_logo_path() -> Path | None:
    return CATALOG_LOGO_FALLBACK if CATALOG_LOGO_FALLBACK.is_file() else None


def _register_fonts(pdfmetrics, TTFont) -> tuple[str, str]:  # type: ignore[no-untyped-def]
    regular_candidates = [
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    ]
    bold_candidates = [
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    ]
    regular_path = next((path for path in regular_candidates if path and path.is_file()), None)
    bold_path = next((path for path in bold_candidates if path and path.is_file()), None)
    if regular_path is None:
        return "Helvetica", "Helvetica-Bold"
    regular_name = "CatalogUnicodeRegular"
    bold_name = "CatalogUnicodeBold"
    try:
        pdfmetrics.registerFont(TTFont(regular_name, str(regular_path)))
        if bold_path is not None:
            pdfmetrics.registerFont(TTFont(bold_name, str(bold_path)))
        else:
            bold_name = regular_name
        return regular_name, bold_name
    except Exception:
        return "Helvetica", "Helvetica-Bold"


def _safe_color(colors, value: str):  # type: ignore[no-untyped-def]
    try:
        return colors.HexColor(value)
    except Exception:
        return colors.HexColor("#15509B")


def _is_remote_image(image_url: str | None) -> bool:
    return urlparse((image_url or "").strip()).scheme in {"http", "https"}


def _load_product_image(image_url: str | None, *, ImageReader):  # type: ignore[no-untyped-def]
    local_path = resolve_product_image_path(image_url)
    if local_path is not None:
        return _load_optimized_product_image(str(local_path), ImageReader=ImageReader)
    if _is_remote_image(image_url):
        return _load_optimized_product_image(image_url or "", ImageReader=ImageReader)
    return None


def _load_optimized_product_image(value: str, *, ImageReader):  # type: ignore[no-untyped-def]
    try:
        from PIL import Image, ImageOps

        parsed = urlparse(value)
        if parsed.scheme in {"http", "https"}:
            request = Request(value, headers={"User-Agent": "UlinkCatalog/1.0"})
            with urlopen(request, timeout=8) as response:
                source = io.BytesIO(response.read(10 * 1024 * 1024 + 1))
            if source.getbuffer().nbytes > 10 * 1024 * 1024:
                return None
        else:
            path = Path(value).expanduser()
            if not path.is_file() or path.stat().st_size > 10 * 1024 * 1024:
                return None
            source = path

        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened)
            image.thumbnail((360, 360), Image.Resampling.LANCZOS)

            if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
                rgba = image.convert("RGBA")
                flattened = Image.new("RGB", rgba.size, "white")
                flattened.paste(rgba, mask=rgba.getchannel("A"))
                image = flattened
            elif image.mode != "RGB":
                image = image.convert("RGB")

            optimized = io.BytesIO()
            image.save(
                optimized,
                format="JPEG",
                quality=80,
                optimize=True,
                progressive=True,
            )
            optimized.seek(0)
            return ImageReader(optimized)
    except Exception:
        return None


def _load_image_reader(value: str, *, ImageReader, max_bytes: int):  # type: ignore[no-untyped-def]
    if not value:
        return None
    try:
        parsed = urlparse(value)
        if parsed.scheme in {"http", "https"}:
            request = Request(value, headers={"User-Agent": "UlinkCatalog/1.0"})
            with urlopen(request, timeout=6) as response:
                payload = response.read(max_bytes + 1)
            if len(payload) > max_bytes:
                return None
            return ImageReader(io.BytesIO(payload))
        path = Path(value).expanduser()
        if path.is_file() and path.stat().st_size <= max_bytes:
            return ImageReader(str(path))
    except Exception:
        return None
    return None


def _draw_contained_image(pdf, image_reader, x: float, y: float, width: float, height: float) -> None:  # type: ignore[no-untyped-def]
    try:
        image_width, image_height = image_reader.getSize()
        if not image_width or not image_height:
            return
        scale = min(width / image_width, height / image_height)
        draw_width = image_width * scale
        draw_height = image_height * scale
        draw_x = x + (width - draw_width) / 2
        draw_y = y + (height - draw_height) / 2
        pdf.drawImage(
            image_reader,
            draw_x,
            draw_y,
            width=draw_width,
            height=draw_height,
            preserveAspectRatio=True,
            mask="auto",
        )
    except Exception:
        return


def _ellipsis(pdf, text: str, font_name: str, font_size: float, max_width: float) -> str:  # type: ignore[no-untyped-def]
    value = str(text or "").strip()
    if pdf.stringWidth(value, font_name, font_size) <= max_width:
        return value
    suffix = "..."
    while value and pdf.stringWidth(value + suffix, font_name, font_size) > max_width:
        value = value[:-1]
    return value.rstrip() + suffix


def _wrap_lines(
    pdf,
    text: str,
    font_name: str,
    font_size: float,
    max_width: float,
    *,
    max_lines: int,
) -> list[str]:  # type: ignore[no-untyped-def]
    words = str(text or "").strip().split()
    if not words:
        return []
    lines: list[str] = []
    current = ""
    while words and len(lines) < max_lines:
        word = words.pop(0)
        candidate = f"{current} {word}".strip()
        if current and pdf.stringWidth(candidate, font_name, font_size) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current and len(lines) < max_lines:
        lines.append(current)
    if words and lines:
        lines[-1] = _ellipsis(
            pdf,
            f"{lines[-1]} {' '.join(words)}",
            font_name,
            font_size,
            max_width,
        )
    return lines[:max_lines]


def _format_price(amount: Decimal, currency: str) -> str:
    if currency.upper() == "USD":
        return f"${Decimal(amount):,.2f}"
    return f"{Decimal(amount):,.2f} {currency.upper()}"
