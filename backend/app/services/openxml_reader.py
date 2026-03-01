from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"


def _q(tag: str) -> str:
    return f"{{{NS_MAIN}}}{tag}"


@dataclass(frozen=True)
class SheetCell:
    ref: str
    value: Any


class OpenXmlWorkbook:
    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser()
        if not self.path.is_file():
            raise FileNotFoundError(str(self.path))

        self._zip = zipfile.ZipFile(self.path, "r")
        self.shared_strings = self._load_shared_strings()
        self.sheets = self._load_sheet_targets()  # name -> xl/worksheets/sheetN.xml

    def close(self) -> None:
        self._zip.close()

    def __enter__(self) -> "OpenXmlWorkbook":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:  # type: ignore[no-untyped-def]
        self.close()

    def list_sheet_names(self) -> list[str]:
        return list(self.sheets.keys())

    def iter_rows(self, sheet_name: str) -> list[tuple[int, dict[str, Any]]]:
        sheet_path = self.sheets.get(sheet_name)
        if sheet_path is None:
            raise KeyError(f"Sheet not found: {sheet_name}")
        xml_bytes = self._zip.read(sheet_path)
        root = ET.fromstring(xml_bytes)
        sheet_data = root.find(_q("sheetData"))
        if sheet_data is None:
            return []

        rows: list[tuple[int, dict[str, Any]]] = []
        for row in sheet_data.findall(_q("row")):
            r = row.attrib.get("r")
            if not r or not r.isdigit():
                continue
            row_idx = int(r)
            values: dict[str, Any] = {}
            for c in row.findall(_q("c")):
                cell_ref = c.attrib.get("r")
                if not cell_ref:
                    continue
                col = _cell_col(cell_ref)
                values[col] = self._parse_cell_value(c)
            rows.append((row_idx, values))
        return rows

    def get_row(self, sheet_name: str, row_idx: int) -> dict[str, Any]:
        for idx, values in self.iter_rows(sheet_name):
            if idx == row_idx:
                return values
        return {}

    def read_table(
        self,
        *,
        sheet_name: str,
        header_row: int,
        headers: list[str],
        start_row: int | None = None,
        stop_when_blank_in: str | None = None,
    ) -> list[dict[str, Any]]:
        header_values = self.get_row(sheet_name, header_row)
        col_by_header: dict[str, str] = {}
        for col, v in header_values.items():
            if isinstance(v, str):
                key = v.strip()
                if key in headers:
                    col_by_header[key] = col

        missing = [h for h in headers if h not in col_by_header]
        if missing:
            raise RuntimeError(f"Missing headers in sheet {sheet_name!r}: {missing}")

        first_row = start_row if start_row is not None else header_row + 1
        stop_col = col_by_header.get(stop_when_blank_in) if stop_when_blank_in else None

        out: list[dict[str, Any]] = []
        for row_idx, row_values in self.iter_rows(sheet_name):
            if row_idx < first_row:
                continue
            if stop_col and (row_values.get(stop_col) in (None, "", Decimal("0"))):
                # Don't stop if there are other meaningful cells; only stop when the stop column is blank
                # and no other requested columns contain data.
                empty = True
                for h, col in col_by_header.items():
                    if row_values.get(col) not in (None, ""):
                        empty = False
                        break
                if empty:
                    break

            record: dict[str, Any] = {}
            for h, col in col_by_header.items():
                record[h] = row_values.get(col)
            out.append(record)
        return out

    def _load_shared_strings(self) -> list[str]:
        try:
            xml_bytes = self._zip.read("xl/sharedStrings.xml")
        except KeyError:
            return []
        root = ET.fromstring(xml_bytes)
        strings: list[str] = []
        for si in root.findall(_q("si")):
            texts: list[str] = []
            for t in si.findall(f".//{_q('t')}"):
                texts.append(t.text or "")
            strings.append("".join(texts))
        return strings

    def _load_sheet_targets(self) -> dict[str, str]:
        wb = ET.fromstring(self._zip.read("xl/workbook.xml"))
        sheets_el = wb.find(_q("sheets"))
        if sheets_el is None:
            return {}

        # map r:id -> sheet file target
        rels_root = ET.fromstring(self._zip.read("xl/_rels/workbook.xml.rels"))
        rel_map: dict[str, str] = {}
        for rel in rels_root.findall(f"{{{NS_PKG_REL}}}Relationship"):
            r_id = rel.attrib.get("Id")
            target = rel.attrib.get("Target")
            typ = rel.attrib.get("Type")
            if not r_id or not target:
                continue
            if typ and typ.endswith("/worksheet"):
                rel_map[r_id] = f"xl/{target}"

        out: dict[str, str] = {}
        for sheet in sheets_el.findall(_q("sheet")):
            name = sheet.attrib.get("name")
            r_id = sheet.attrib.get(f"{{{NS_OFFICE_REL}}}id")
            if not name or not r_id:
                continue
            target = rel_map.get(r_id)
            if target:
                out[name] = target
        return out

    def _parse_cell_value(self, cell: ET.Element) -> Any:
        t = cell.attrib.get("t")
        if t == "s":
            v = cell.find(_q("v"))
            if v is None or v.text is None:
                return None
            try:
                idx = int(v.text)
            except ValueError:
                return None
            return self.shared_strings[idx] if 0 <= idx < len(self.shared_strings) else None

        if t == "inlineStr":
            t_el = cell.find(f"{_q('is')}/{_q('t')}")
            return t_el.text if t_el is not None else None

        v = cell.find(_q("v"))
        if v is None or v.text is None:
            return None

        if t == "str":
            return v.text

        # numeric by default
        try:
            return Decimal(v.text)
        except Exception:
            return v.text


_CELL_COL_RE = re.compile(r"^([A-Z]+)")


def _cell_col(cell_ref: str) -> str:
    m = _CELL_COL_RE.match(cell_ref)
    return m.group(1) if m else cell_ref
