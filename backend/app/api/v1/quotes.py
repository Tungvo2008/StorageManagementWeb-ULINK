from __future__ import annotations

import html
import json
from datetime import date, timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import Product, ShowcaseItem, StorefrontInquiry, StorefrontQuote

router = APIRouter(prefix="/quotes", tags=["quotes"])


class QuoteLine(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    quantity: int = Field(ge=1, le=100000)
    unit_price: Decimal | None = Field(default=None, ge=0)


class QuoteInput(BaseModel):
    inquiry_id: int
    lines: list[QuoteLine] = Field(min_length=1, max_length=50)
    currency: str = Field(default="USD", pattern="^(USD|VND)$")
    valid_until: date | None = None
    incoterm: str = Field(default="TBD", max_length=80)
    payment_terms: str = Field(default="To be confirmed", max_length=300)
    delivery_terms: str = Field(default="To be confirmed", max_length=300)
    notes: str = Field(default="", max_length=2000)


def serialize(q: StorefrontQuote) -> dict:
    return {"id": q.id, "reference": q.reference, "inquiry_id": q.inquiry_id,
            "customer_name": q.customer_name, "customer_email": q.customer_email,
            "customer_phone": q.customer_phone, "customer_address": q.customer_address,
            "company": q.company, "currency": q.currency, "valid_until": q.valid_until.isoformat() if q.valid_until else None,
            "incoterm": q.incoterm, "payment_terms": q.payment_terms, "delivery_terms": q.delivery_terms,
            "notes": q.notes, "lines": json.loads(q.lines_json), "status": "DRAFT",
            "created_at": q.created_at.isoformat()}


@router.get("/inquiries")
def inquiries(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(StorefrontInquiry).order_by(StorefrontInquiry.created_at.desc()).limit(100)).all()
    return [{"id": r.id, "reference": r.reference, "name": r.name, "email": r.email,
             "phone": r.phone, "address": r.address, "company": r.company,
             "items": json.loads(r.items_json), "message": r.message, "kind": "consultation" if r.reference.startswith("ULC-") else "wholesale", "created_at": r.created_at.isoformat()} for r in rows]


@router.get("")
def list_quotes(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(StorefrontQuote).order_by(StorefrontQuote.created_at.desc()).limit(100)).all()
    return [serialize(q) for q in rows]


@router.post("", status_code=201)
def create_quote(payload: QuoteInput, db: Session = Depends(get_db)) -> dict:
    inquiry = db.get(StorefrontInquiry, payload.inquiry_id)
    if not inquiry:
        raise HTTPException(404, "Inquiry not found")
    allowed = {x["sku"].casefold(): x for x in json.loads(inquiry.items_json)}
    if len({x.sku.casefold() for x in payload.lines}) != len(payload.lines):
        raise HTTPException(422, "Duplicate SKU")
    if any(x.sku.casefold() not in allowed for x in payload.lines):
        raise HTTPException(422, "SKU is not part of the selected inquiry")
    products = db.scalars(select(Product).where(Product.sku.in_([x.sku for x in payload.lines]))).all()
    by_sku = {p.sku.casefold(): p for p in products}
    showcases = db.scalars(select(ShowcaseItem).where(ShowcaseItem.code.in_([x.sku for x in payload.lines]))).all()
    by_showcase = {s.code.casefold(): s for s in showcases}
    if len(set(by_sku) | set(by_showcase)) != len(payload.lines):
        raise HTTPException(422, "Product not found")
    lines = []
    for item in payload.lines:
        p = by_sku.get(item.sku.casefold())
        if p is None:
            showcase = by_showcase[item.sku.casefold()]
            lines.append({"sku": showcase.code, "name": showcase.name,
                          "quantity": item.quantity, "unit_price": str(item.unit_price) if item.unit_price is not None else None,
                          "unit": "item", "hs_code": None, "case_pack": None,
                          "net_kg": None, "gross_kg": None, "carton_cm": [None, None, None],
                          "carton_cbm": None, "cartons_20ft": None, "cartons_40ft": None,
                          "logistics_estimate": False})
            continue
        specs = json.loads(p.specifications or "{}")
        if not isinstance(specs, dict):
            specs = {}
        lines.append({"sku": p.sku, "name": p.catalog_short_name or p.name,
                      "quantity": item.quantity, "unit_price": str(item.unit_price) if item.unit_price is not None else None,
                      "unit": p.uom or p.base_uom or "pc", "hs_code": p.hs_code,
                      "case_pack": p.catalog_case_pack,
                      "net_kg": str(p.carton_net_weight_kg) if p.carton_net_weight_kg is not None else None,
                      "gross_kg": str(p.carton_gross_weight_kg) if p.carton_gross_weight_kg is not None else None,
                      "carton_cm": [str(v) if v is not None else None for v in (p.carton_length_cm, p.carton_width_cm, p.carton_height_cm)],
                      "carton_cbm": str((p.carton_length_cm * p.carton_width_cm * p.carton_height_cm / Decimal(1000000)).quantize(Decimal('0.000001')))
                          if all(v is not None for v in (p.carton_length_cm, p.carton_width_cm, p.carton_height_cm)) else None,
                      "cartons_20ft": p.cartons_per_20ft, "cartons_40ft": p.cartons_per_40ft,
                      "logistics_estimate": bool(specs.get("_logistics_estimate"))})
    quote = StorefrontQuote(
        inquiry_id=inquiry.id, reference="PENDING", customer_name=inquiry.name,
        customer_email=inquiry.email, customer_phone=inquiry.phone, customer_address=inquiry.address,
        company=inquiry.company, currency=payload.currency,
        valid_until=payload.valid_until or date.today() + timedelta(days=14),
        incoterm=payload.incoterm.strip(), payment_terms=payload.payment_terms.strip(),
        delivery_terms=payload.delivery_terms.strip(), notes=payload.notes.strip(),
        lines_json=json.dumps(lines, ensure_ascii=False),
    )
    db.add(quote)
    db.flush()
    quote.reference = f"ULQ-DRAFT-{quote.id:06d}"
    db.commit()
    db.refresh(quote)
    return serialize(quote)


@router.get("/{quote_id}/pdf")
def quote_pdf(quote_id: int, db: Session = Depends(get_db)) -> Response:
    q = db.get(StorefrontQuote, quote_id)
    if not q:
        raise HTTPException(404, "Quote not found")
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image

    fonts = Path(__file__).resolve().parents[3] / "assets" / "fonts"
    pdfmetrics.registerFont(TTFont("DejaVuQuote", str(fonts / "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("DejaVuQuoteBold", str(fonts / "DejaVuSans-Bold.ttf")))
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="QBody", fontName="DejaVuQuote", fontSize=8, leading=12))
    styles.add(ParagraphStyle(name="QSmall", fontName="DejaVuQuote", fontSize=7, leading=10))
    styles.add(ParagraphStyle(name="QHead", fontName="DejaVuQuoteBold", fontSize=17, leading=22, textColor=colors.HexColor("#17365b")))
    styles.add(ParagraphStyle(name="QCell", fontName="DejaVuQuote", fontSize=7, leading=9))
    esc = lambda x: html.escape(str(x or "—"))
    P = lambda x, style="QBody": Paragraph(esc(x), styles[style])
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=32, rightMargin=32, topMargin=27, bottomMargin=30)
    story = []
    logo = Path(__file__).resolve().parents[3] / "assets" / "logo.png"
    if logo.exists():
        img = Image(str(logo), width=90, height=42, kind="proportional")
        story.append(img)
    story.extend([P("ULINK LLC · DRAFT QUOTATION", "QHead"), Spacer(1, 7),
                  P(f"Reference: {q.reference}    Date: {q.created_at.date().isoformat()}    Valid until: {q.valid_until.isoformat() if q.valid_until else '—'}"),
                  P(f"To: {q.customer_name}  |  {q.company or '—'}  |  {q.customer_email}  |  {q.customer_phone or '—'}"),
                  P(f"Address: {q.customer_address or '—'}"), Spacer(1, 12)])
    heads = ["SKU / Product", "Qty", "Unit", "Unit price", "Line total", "HS", "Pcs/ctn", "N/G kg", "Carton cm", "CBM", "20'/40'"]
    data = [[P(x, "QCell") for x in heads]]
    total = Decimal("0")
    incomplete = False
    estimate = False
    for line in json.loads(q.lines_json):
        price = Decimal(line["unit_price"]) if line["unit_price"] is not None else None
        if price is None:
            incomplete = True
        amount = price * line["quantity"] if price is not None else None
        if amount is not None:
            total += amount
        estimate = estimate or line.get("logistics_estimate", False)
        dims = "×".join(v or "?" for v in line["carton_cm"])
        data.append([P(f'{line["sku"]} — {line["name"]}', "QCell"), P(line["quantity"], "QCell"),
                     P(line["unit"], "QCell"), P(f'{price:,.2f}' if price is not None else "TBD", "QCell"),
                     P(f'{amount:,.2f}' if amount is not None else "TBD", "QCell"), P(line["hs_code"], "QCell"),
                     P(line["case_pack"], "QCell"), P(f'{line["net_kg"] or "?"}/{line["gross_kg"] or "?"}', "QCell"),
                     P(dims, "QCell"), P(line["carton_cbm"], "QCell"),
                     P(f'{line["cartons_20ft"] or "?"}/{line["cartons_40ft"] or "?"}', "QCell")])
    table = Table(data, colWidths=[164, 31, 43, 61, 64, 48, 45, 58, 74, 54, 62], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dce9f3")),
        ("GRID", (0, 0), (-1, -1), .4, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.extend([table, Spacer(1, 10), P(f"Subtotal ({q.currency}): {total:,.2f}" + (" + TBD prices" if incomplete else "")),
                  P(f"Incoterm: {q.incoterm}  |  Payment: {q.payment_terms}  |  Delivery: {q.delivery_terms}"),
                  P(f"Notes: {q.notes or '—'}"), Spacer(1, 7),
                  P("DRAFT ONLY · Not an offer or invoice. Prices, freight, taxes, availability and terms require approval.", "QSmall")])
    if estimate:
        story.append(P("Carton quantities, weights, dimensions and container counts marked as temporary estimates; verify before sending to a customer.", "QSmall"))
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("DejaVuQuoteBold", 8)
        canvas.setFillColor(colors.HexColor("#b91c1c"))
        canvas.drawRightString(landscape(A4)[0] - 32, 16, f"DRAFT · Page {doc.page}")
        canvas.restoreState()
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return Response(content=buf.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{q.reference}.pdf"', "Cache-Control": "no-store"})
