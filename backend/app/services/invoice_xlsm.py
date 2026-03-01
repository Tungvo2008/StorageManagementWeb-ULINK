from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Customer, Invoice, Product

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _q(tag: str) -> str:
    return f"{{{NS_MAIN}}}{tag}"


ET.register_namespace("", NS_MAIN)
ET.register_namespace("r", NS_OFFICE_REL)


@dataclass(frozen=True)
class TransferLine:
    no: int
    description: str
    uom: str
    quantity: int
    unit_price: Decimal
    total: Decimal


def render_invoice_xlsm(invoice: Invoice, customer: Customer | None, db: Session) -> bytes:
    template_path = Path(settings.INVOICE_TEMPLATE_XLSM_PATH).expanduser()
    if not template_path.is_file():
        raise RuntimeError(
            "INVOICE_TEMPLATE_XLSM_PATH is not set or file not found. "
            "Set it to your Excel template .xlsm path."
        )

    products = _load_products(db, invoice)
    transfer_lines = _build_transfer_lines(invoice, products)

    issued_date = invoice.issued_at.astimezone().date()
    excel_date = _date_to_excel_serial(issued_date)
    invoice_seq = _extract_invoice_seq(invoice.invoice_number, settings.INVOICE_PREFIX)

    if invoice_seq is None:
        raise RuntimeError(f"Cannot extract invoice sequence from invoice_number={invoice.invoice_number!r}")

    customer_name = invoice.client_name_snapshot or (customer.name if customer else "Walk-in customer")
    tele = invoice.tele_snapshot or (customer.phone if customer else "")
    address = invoice.address_snapshot or (customer.address if customer else "")
    city = invoice.city_snapshot or (customer.city if customer else "")
    zip_code = invoice.zip_code_snapshot or (customer.zip_code if customer else "")

    with zipfile.ZipFile(template_path, "r") as zin:
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for info in zin.infolist():
                if info.filename == "xl/worksheets/sheet1.xml":
                    xml_bytes = zin.read(info.filename)
                    new_xml = _fill_transfer_sheet(
                        xml_bytes,
                        lines=transfer_lines,
                        excel_date=excel_date,
                        invoice_seq=invoice_seq,
                        client=customer_name,
                        tele=tele,
                        address=address,
                        city=city,
                        zip_code=zip_code,
                    )
                    zout.writestr(info, new_xml)
                elif info.filename == "xl/workbook.xml":
                    xml_bytes = zin.read(info.filename)
                    zout.writestr(info, _hide_sheets_and_remove_external_refs(xml_bytes))
                elif info.filename == "xl/_rels/workbook.xml.rels":
                    xml_bytes = zin.read(info.filename)
                    zout.writestr(info, _remove_external_link_relationships(xml_bytes))
                else:
                    zout.writestr(info, zin.read(info.filename))
        return out.getvalue()


def _load_products(db: Session, invoice: Invoice) -> dict[int, Product]:
    product_ids = {line.product_id for line in invoice.lines}
    if not product_ids:
        return {}
    items = db.scalars(select(Product).where(Product.id.in_(product_ids))).all()
    return {p.id: p for p in items}


def _build_transfer_lines(invoice: Invoice, products: dict[int, Product]) -> list[TransferLine]:
    lines: list[TransferLine] = []
    for idx, line in enumerate(invoice.lines, start=1):
        product = products.get(line.product_id)
        uom = line.uom or (product.uom if product else "")
        unit_price = Decimal(line.unit_price)
        total = Decimal(line.line_total)
        lines.append(
            TransferLine(
                no=idx,
                description=line.product_name,
                uom=uom,
                quantity=int(line.quantity),
                unit_price=unit_price,
                total=total,
            )
        )
    return lines


def _extract_invoice_seq(invoice_number: str, prefix: str) -> int | None:
    prefix = (prefix or "").strip()
    if prefix and invoice_number.startswith(prefix):
        tail = invoice_number[len(prefix) :]
        if tail.isdigit():
            return int(tail)

    m = re.search(r"(\d+)$", invoice_number)
    if not m:
        return None
    return int(m.group(1))


def _date_to_excel_serial(d: date) -> int:
    # Excel 1900 system (works for modern dates; matches values in provided .xlsm)
    base = date(1899, 12, 30)
    return (d - base).days


def _fill_transfer_sheet(
    xml_bytes: bytes,
    *,
    lines: list[TransferLine],
    excel_date: int,
    invoice_seq: int,
    client: str,
    tele: str,
    address: str,
    city: str,
    zip_code: str,
) -> bytes:
    max_lines = 22  # Transfer! rows 2..23
    if len(lines) > max_lines:
        raise RuntimeError(f"Invoice has {len(lines)} lines but template supports max {max_lines}")

    root = ET.fromstring(xml_bytes)
    sheet_data = root.find(_q("sheetData"))
    if sheet_data is None:
        raise RuntimeError("Invalid template: missing sheetData in Transfer sheet")

    row_by_idx: dict[int, ET.Element] = {}
    for row in sheet_data.findall(_q("row")):
        r = row.attrib.get("r")
        if r and r.isdigit():
            row_by_idx[int(r)] = row

    def get_or_create_row(row_idx: int) -> ET.Element:
        row = row_by_idx.get(row_idx)
        if row is not None:
            return row
        row = ET.Element(_q("row"), {"r": str(row_idx)})
        sheet_data.append(row)
        row_by_idx[row_idx] = row
        return row

    def get_or_create_cell(row: ET.Element, cell_ref: str) -> ET.Element:
        for c in row.findall(_q("c")):
            if c.attrib.get("r") == cell_ref:
                return c
        c = ET.SubElement(row, _q("c"), {"r": cell_ref})
        return c

    def clear_cell(cell: ET.Element) -> None:
        for child in list(cell):
            cell.remove(child)
        cell.attrib.pop("t", None)
        cell.attrib.pop("cm", None)

    def set_cell(cell: ET.Element, value: Any) -> None:
        clear_cell(cell)
        if value is None:
            return
        if isinstance(value, str):
            value = value.strip("\n")
            if value == "":
                return
            cell.set("t", "inlineStr")
            is_el = ET.SubElement(cell, _q("is"))
            t_el = ET.SubElement(is_el, _q("t"))
            t_el.text = value
            return

        if isinstance(value, bool):
            v = ET.SubElement(cell, _q("v"))
            v.text = "1" if value else "0"
            return

        if isinstance(value, (int, float, Decimal)):
            v = ET.SubElement(cell, _q("v"))
            v.text = str(value)
            return

        if isinstance(value, datetime):
            v = ET.SubElement(cell, _q("v"))
            v.text = str(_date_to_excel_serial(value.date()))
            return

        raise RuntimeError(f"Unsupported cell value type: {type(value)}")

    # Header fields in row 2
    row2 = get_or_create_row(2)
    set_cell(get_or_create_cell(row2, "G2"), excel_date)
    set_cell(get_or_create_cell(row2, "H2"), int(invoice_seq))
    set_cell(get_or_create_cell(row2, "I2"), client)
    set_cell(get_or_create_cell(row2, "J2"), tele or "")
    set_cell(get_or_create_cell(row2, "K2"), address or "")
    set_cell(get_or_create_cell(row2, "L2"), city or "")
    set_cell(get_or_create_cell(row2, "M2"), zip_code or "")

    # Line items rows 2..23 columns A..F
    for i in range(max_lines):
        row_idx = 2 + i
        row = get_or_create_row(row_idx)
        line = lines[i] if i < len(lines) else None

        if line is None:
            for col in ["A", "B", "C", "D", "E", "F"]:
                set_cell(get_or_create_cell(row, f"{col}{row_idx}"), None)
            continue

        set_cell(get_or_create_cell(row, f"A{row_idx}"), line.no)
        set_cell(get_or_create_cell(row, f"B{row_idx}"), line.description)
        set_cell(get_or_create_cell(row, f"C{row_idx}"), line.uom)
        set_cell(get_or_create_cell(row, f"D{row_idx}"), int(line.quantity))
        set_cell(get_or_create_cell(row, f"E{row_idx}"), line.unit_price)
        set_cell(get_or_create_cell(row, f"F{row_idx}"), line.total)

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _hide_sheets_and_remove_external_refs(xml_bytes: bytes) -> bytes:
    root = ET.fromstring(xml_bytes)

    # remove externalReferences to avoid "update links" prompts
    ext_refs = root.find(_q("externalReferences"))
    if ext_refs is not None:
        root.remove(ext_refs)

    sheets_el = root.find(_q("sheets"))
    if sheets_el is not None:
        for sheet in sheets_el.findall(_q("sheet")):
            name = sheet.attrib.get("name", "")
            if name == "Sample Invoice":
                sheet.attrib.pop("state", None)
            elif name == "Transfer":
                sheet.set("state", "veryHidden")
            else:
                sheet.set("state", "hidden")

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _remove_external_link_relationships(xml_bytes: bytes) -> bytes:
    root = ET.fromstring(xml_bytes)
    to_remove: list[ET.Element] = []
    for rel in root.findall(f"{{{NS_REL}}}Relationship"):
        if rel.attrib.get("Type", "").endswith("/externalLink"):
            to_remove.append(rel)
    for rel in to_remove:
        root.remove(rel)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)
