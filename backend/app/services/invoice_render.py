from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import zipfile

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.config import settings
from app.db.models import Customer, Invoice


@dataclass(frozen=True)
class CompanyInfo:
    name: str
    address: str
    phone: str
    email: str
    tax_code: str


def get_company_info() -> CompanyInfo:
    return CompanyInfo(
        name=settings.COMPANY_NAME,
        address=settings.COMPANY_ADDRESS,
        phone=settings.COMPANY_PHONE,
        email=settings.COMPANY_EMAIL,
        tax_code=settings.COMPANY_TAX_CODE,
    )


def format_money(amount: Decimal, currency: str) -> str:
    currency = (currency or "").upper() or settings.DEFAULT_CURRENCY
    if currency == "VND":
        quant = Decimal("1")
        normalized = Decimal(amount).quantize(quant, rounding=ROUND_HALF_UP)
        return f"{normalized:,.0f} {currency}"

    normalized = Decimal(amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{normalized:,.2f} {currency}"


def render_invoice_html(invoice: Invoice, customer: Customer | None) -> str:
    templates_dir = Path(__file__).resolve().parents[1] / "templates"
    env = Environment(
        loader=FileSystemLoader(str(templates_dir)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    env.globals["fmt_money"] = lambda amount: format_money(amount, invoice.currency)

    template = env.get_template("invoice.html.j2")

    issued_date = _format_date(invoice.issued_at)
    due_date = _format_date(invoice.due_at) if invoice.due_at else None

    return template.render(
        company=get_company_info(),
        invoice=invoice,
        customer=customer,
        issued_date=issued_date,
        due_date=due_date,
    )


def render_invoice_pdf(invoice: Invoice, customer: Customer | None) -> bytes:
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import inch
        from reportlab.lib.utils import ImageReader
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.pdfgen import canvas
    except Exception as e:  # pragma: no cover
        raise RuntimeError(
            "reportlab is required for PDF export. Install it or use the HTML export."
        ) from e

    company = get_company_info()

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    width, height = letter

    ORANGE = colors.HexColor("#F36C21")
    GRID = colors.HexColor("#1a1a1a")
    LIGHT_GRID = colors.HexColor("#d9d9d9")

    margin = 0.55 * inch
    x0 = margin
    x1 = width - margin

    def draw_top_bottom_bars() -> None:
        bar_h = 0.12 * inch
        c.setFillColor(ORANGE)
        c.setStrokeColor(ORANGE)
        c.rect(0, height - bar_h, width, bar_h, fill=1, stroke=0)
        c.rect(0, 0, width, bar_h, fill=1, stroke=0)
        c.setFillColor(colors.black)
        c.setStrokeColor(colors.black)

    def split_lines(v: str) -> list[str]:
        if not v:
            return []
        out: list[str] = []
        for raw in str(v).replace("|", "\n").splitlines():
            s = raw.strip()
            if s:
                out.append(s)
        return out

    def fmt_usd(amount: Decimal) -> str:
        normalized = Decimal(amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if normalized < 0:
            return f"-${abs(normalized):,.2f}"
        return f"${normalized:,.2f}"

    def fmt_money_symbol(amount: Decimal, currency: str) -> str:
        cur = (currency or "").upper() or settings.DEFAULT_CURRENCY
        if cur == "USD":
            return fmt_usd(amount)
        return format_money(amount, cur)

    def fmt_tax_rate(rate: Decimal) -> str:
        try:
            pct = (Decimal(rate) * Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        except Exception:
            pct = Decimal("0.00")
        return f"{pct:.2f}%"

    def fmt_date_long(dt: datetime) -> str:
        d = dt.astimezone().date()
        return f"{d.strftime('%B')} {d.day}, {d.year}"

    def load_logo_reader() -> ImageReader | None:
        logo_path = getattr(settings, "COMPANY_LOGO_PATH", "")
        if isinstance(logo_path, str) and logo_path.strip():
            p = Path(logo_path).expanduser()
            if p.is_file():
                return ImageReader(str(p))
        # fallback: pull first image from template (xl/media/image1.png)
        template_path = Path(settings.INVOICE_TEMPLATE_XLSM_PATH).expanduser()
        if template_path.is_file():
            try:
                with zipfile.ZipFile(template_path, "r") as z:
                    if "xl/media/image1.png" in z.namelist():
                        return ImageReader(io.BytesIO(z.read("xl/media/image1.png")))
            except Exception:
                return None
        return None

    def resolve_pdf_fonts() -> tuple[str, str]:
        default_regular = "Helvetica"
        default_bold = "Helvetica-Bold"

        regular_candidates: list[Path] = []
        user_regular = (getattr(settings, "INVOICE_PDF_FONT_PATH", "") or "").strip()
        if user_regular:
            regular_candidates.append(Path(user_regular).expanduser())
        regular_candidates.extend(
            [
                # macOS
                Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
                Path("/System/Library/Fonts/Supplemental/Arial Unicode MS.ttf"),
                Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
                Path("/System/Library/Fonts/Supplemental/Times New Roman.ttf"),
                Path("/Library/Fonts/Arial Unicode.ttf"),
                # Linux (Debian/Ubuntu common)
                Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
                Path("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"),
                Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
                Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
                Path("/usr/share/fonts/truetype/freefont/FreeSans.ttf"),
            ]
        )

        bold_candidates: list[Path] = []
        user_bold = (getattr(settings, "INVOICE_PDF_FONT_BOLD_PATH", "") or "").strip()
        if user_bold:
            bold_candidates.append(Path(user_bold).expanduser())

        for font_path in regular_candidates:
            if not font_path.is_file():
                continue
            try:
                pdfmetrics.registerFont(TTFont("InvoiceUnicodeRegular", str(font_path)))
                regular_name = "InvoiceUnicodeRegular"
            except Exception:
                continue

            base_name = font_path.name
            inferred_bold: list[Path] = []
            if "Arial Unicode" in base_name:
                inferred_bold.extend(
                    [
                        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
                        Path("/Library/Fonts/Arial Bold.ttf"),
                    ]
                )
            if "DejaVuSans" in base_name:
                inferred_bold.append(font_path.with_name("DejaVuSans-Bold.ttf"))
            if "NotoSans-Regular" in base_name:
                inferred_bold.append(font_path.with_name("NotoSans-Bold.ttf"))
            if "LiberationSans-Regular" in base_name:
                inferred_bold.append(font_path.with_name("LiberationSans-Bold.ttf"))
            if "FreeSans" in base_name:
                inferred_bold.append(font_path.with_name("FreeSansBold.ttf"))
            if base_name.lower().endswith(".ttf"):
                inferred_bold.append(font_path.with_name(base_name[:-4] + " Bold.ttf"))
            if base_name.lower().endswith(".otf"):
                inferred_bold.append(font_path.with_name(base_name[:-4] + " Bold.otf"))

            all_bold_candidates = [*bold_candidates, *inferred_bold]
            for bold_path in all_bold_candidates:
                if not bold_path.is_file():
                    continue
                try:
                    pdfmetrics.registerFont(TTFont("InvoiceUnicodeBold", str(bold_path)))
                    return regular_name, "InvoiceUnicodeBold"
                except Exception:
                    continue

            return regular_name, regular_name

        return default_regular, default_bold

    font_regular, font_bold = resolve_pdf_fonts()

    def set_font(size: float, *, bold: bool = False) -> None:
        c.setFont(font_bold if bold else font_regular, size)

    # Resolve customer snapshot for stable output
    cust_name = invoice.client_name_snapshot or (customer.name if customer else "Walk-in customer")
    cust_phone = invoice.tele_snapshot or (customer.phone if customer else "")
    cust_addr = invoice.address_snapshot or (customer.address if customer else "")
    cust_city = invoice.city_snapshot or (customer.city if customer else "")
    cust_zip = invoice.zip_code_snapshot or (customer.zip_code if customer else "")
    city_zip = ""
    if cust_city and cust_zip:
        city_zip = f"{cust_city}, {cust_zip}"
    else:
        city_zip = cust_city or cust_zip

    # Header
    draw_top_bottom_bars()

    y = height - margin - 0.15 * inch

    logo = load_logo_reader()
    logo_w = 0.0
    if logo is not None:
        desired_h = 0.95 * inch
        desired_w = 1.35 * inch
        c.drawImage(logo, x0, y - desired_h + 0.1 * inch, width=desired_w, height=desired_h, mask="auto")
        logo_w = desired_w + 0.2 * inch

    company_name = (company.name or "").strip()
    if company_name:
        set_font(16, bold=True)
        c.drawString(x0 + logo_w, y, company_name)

    set_font(9)
    info_lines: list[tuple[str, str]] = []
    info_lines += [("➤", line) for line in split_lines(company.address)]
    info_lines += [("✆", line) for line in split_lines(company.phone)]
    info_lines += [("✉", line) for line in split_lines(company.email)]
    info_lines += [("#", line) for line in split_lines(company.tax_code)]
    info_y = y - 0.28 * inch
    for icon, line in info_lines[:4]:
        c.drawString(x0 + logo_w, info_y, f"{icon} {line}")
        info_y -= 0.18 * inch

    # Invoice title + fields (right side)
    set_font(20, bold=True)
    c.drawRightString(x1, y, "INVOICE")

    set_font(9, bold=True)
    label_x = x1 - 2.2 * inch
    value_x = x1

    date_label_y = y - 0.45 * inch
    c.drawString(label_x, date_label_y, "DATE")
    set_font(10)
    c.drawRightString(value_x, date_label_y, fmt_date_long(invoice.issued_at))
    c.setStrokeColor(GRID)
    c.setLineWidth(0.8)
    c.line(x1 - 1.6 * inch, date_label_y - 0.05 * inch, x1, date_label_y - 0.05 * inch)

    set_font(9, bold=True)
    inv_label_y = y - 0.72 * inch
    c.drawString(label_x, inv_label_y, "INVOICE NO.")
    set_font(10, bold=True)
    c.drawRightString(value_x, inv_label_y, invoice.invoice_number)
    c.line(x1 - 1.2 * inch, inv_label_y - 0.05 * inch, x1, inv_label_y - 0.05 * inch)

    # Bill/Ship blocks
    block_top = y - 1.25 * inch
    col_gap = 0.35 * inch
    col_w = (x1 - x0 - col_gap) / 2
    bill_x = x0
    ship_x = x0 + col_w + col_gap

    c.setStrokeColor(LIGHT_GRID)
    c.setLineWidth(1)
    c.line(x0, block_top, x1, block_top)

    set_font(10, bold=True)
    c.setFillColor(colors.black)
    c.drawString(bill_x, block_top - 0.25 * inch, "BILL TO")
    c.drawString(ship_x, block_top - 0.25 * inch, "SHIP TO")

    set_font(10)
    bill_lines = [cust_name, cust_phone, cust_addr, city_zip]
    ship_lines = [cust_name, cust_phone, cust_addr, city_zip]
    text_start_y = block_top - 0.45 * inch
    for i, line in enumerate(bill_lines):
        if not line:
            continue
        c.drawString(bill_x, text_start_y - i * 0.2 * inch, str(line))
    for i, line in enumerate(ship_lines):
        if not line:
            continue
        c.drawString(ship_x, text_start_y - i * 0.2 * inch, str(line))

    # Table
    table_top = block_top - 1.15 * inch
    header_h = 0.28 * inch
    row_h = 0.25 * inch
    max_rows = 22
    if len(invoice.lines) > max_rows:
        raise RuntimeError(f"Invoice has {len(invoice.lines)} lines but PDF template supports max {max_rows}")

    col_widths = [0.45 * inch, 3.55 * inch, 0.9 * inch, 0.9 * inch, 1.05 * inch, 1.05 * inch]
    total_w = sum(col_widths)
    # fit to content width if needed
    available_w = x1 - x0
    if abs(total_w - available_w) > 1:
        scale = available_w / total_w
        col_widths = [w * scale for w in col_widths]

    col_x: list[float] = [x0]
    for w in col_widths:
        col_x.append(col_x[-1] + w)

    # Header background
    c.setFillColor(ORANGE)
    c.rect(x0, table_top - header_h, x1 - x0, header_h, fill=1, stroke=0)
    c.setFillColor(colors.white)
    set_font(10, bold=True)
    headers = ["NO.", "DESCRIPTION", "UNIT", "QUANTITY", "UNIT PRICE", "TOTAL"]
    for i, h in enumerate(headers):
        cx = col_x[i] + 4
        if i in (3, 4, 5):
            c.drawRightString(col_x[i + 1] - 4, table_top - header_h + 0.09 * inch, h)
        else:
            c.drawString(cx, table_top - header_h + 0.09 * inch, h)

    # Grid
    c.setStrokeColor(GRID)
    c.setLineWidth(1)
    c.line(x0, table_top - header_h, x1, table_top - header_h)
    c.setStrokeColor(LIGHT_GRID)
    c.setLineWidth(0.8)
    # verticals
    for xx in col_x:
        c.line(xx, table_top - header_h, xx, table_top - header_h - max_rows * row_h)
    # horizontals + cell text
    set_font(10)
    c.setFillColor(colors.black)
    for r in range(max_rows):
        y_top = table_top - header_h - r * row_h
        y_bottom = y_top - row_h
        c.line(x0, y_bottom, x1, y_bottom)

        line = invoice.lines[r] if r < len(invoice.lines) else None
        if line is None:
            continue

        desc = (line.product_name or "")[:60]
        unit = (line.uom or "")[:12]
        qty = int(line.quantity)
        unit_price = fmt_money_symbol(Decimal(line.unit_price), invoice.currency)
        total = fmt_money_symbol(Decimal(line.line_total), invoice.currency)

        baseline = y_bottom + 0.07 * inch
        c.drawString(col_x[0] + 6, baseline, str(r + 1))
        c.drawString(col_x[1] + 6, baseline, desc)
        c.drawString(col_x[2] + 6, baseline, unit)
        c.drawRightString(col_x[4] - 6, baseline, str(qty))
        c.drawRightString(col_x[5] - 6, baseline, unit_price)
        c.drawRightString(col_x[6] - 6, baseline, total)

    table_bottom = table_top - header_h - max_rows * row_h

    # Summary (right)
    summary_x_right = x1
    summary_label_x = x1 - 2.5 * inch
    sy = table_bottom - 0.2 * inch

    discount = Decimal(getattr(invoice, "discount_amount", Decimal("0")) or 0)
    shipping = Decimal(getattr(invoice, "shipping_amount", Decimal("0")) or 0)
    subtotal_less_discount = Decimal(invoice.subtotal_amount) - discount
    balance_due = subtotal_less_discount + Decimal(invoice.tax_amount) + shipping

    set_font(10)
    c.setFillColor(colors.black)

    def summary_row(label: str, value: str, *, bold: bool = False, big: bool = False) -> None:
        nonlocal sy
        set_font(10 if not big else 14, bold=bold)
        c.drawRightString(summary_label_x, sy, label)
        c.drawRightString(summary_x_right, sy, value)
        sy -= 0.24 * inch if not big else 0.32 * inch

    summary_row("SUBTOTAL", fmt_money_symbol(Decimal(invoice.subtotal_amount), invoice.currency))
    summary_row("DISCOUNT", fmt_money_symbol(discount, invoice.currency))
    summary_row("SUBTOTAL LESS DISCOUNT", fmt_money_symbol(subtotal_less_discount, invoice.currency))
    summary_row("TAX RATE", fmt_tax_rate(Decimal(invoice.tax_rate)))
    summary_row("TOTAL TAX", fmt_money_symbol(Decimal(invoice.tax_amount), invoice.currency))
    summary_row("SHIPPING HANDLING", fmt_money_symbol(shipping, invoice.currency))

    c.setStrokeColor(LIGHT_GRID)
    c.setLineWidth(1)
    c.line(summary_label_x - 0.2 * inch, sy + 0.12 * inch, summary_x_right, sy + 0.12 * inch)
    sy -= 0.12 * inch
    summary_row("BALANCE DUE", fmt_money_symbol(balance_due, invoice.currency), bold=True, big=True)

    # Footer payment info (left)
    footer_lines = split_lines(getattr(settings, "INVOICE_PAYMENT_LINES", ""))
    if footer_lines:
        fy = 0.7 * inch
        set_font(9)
        for line in footer_lines[:6]:
            c.drawString(x0, fy, line)
            fy += 0.18 * inch

    c.save()
    return buf.getvalue()


def _format_date(dt: datetime) -> str:
    # Hiển thị dạng YYYY-MM-DD để dễ đọc và nhất quán
    return dt.astimezone().strftime("%Y-%m-%d")
