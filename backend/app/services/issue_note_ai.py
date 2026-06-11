from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
import json
import re
from typing import Any
import unicodedata
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest

from fastapi import HTTPException

from app.core.config import settings
from app.db.models import Product


@dataclass
class ParsedIssueLine:
    raw_text: str
    quantity: int
    raw_name: str
    unit: str
    product_id: int | None
    sku: str | None
    matched_product_name: str | None
    confidence: float
    match_source: str


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    without_accents = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    without_symbols = re.sub(r"[^a-zA-Z0-9\s]+", " ", without_accents)
    return re.sub(r"\s+", " ", without_symbols).strip().lower()


def _catalog_for_prompt(products: list[Product]) -> list[dict[str, Any]]:
    return [
        {
            "id": product.id,
            "sku": product.sku,
            "name": product.name,
            "base_uom": product.base_uom,
            "sale_uom": product.uom,
        }
        for product in products
        if product.is_active
    ]


def _extract_gemini_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates") or []
    for candidate in candidates:
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                return text
    raise HTTPException(status_code=502, detail="Gemini response did not contain any text output")


def _call_gemini_parse(note_text: str, products: list[Product]) -> dict[str, Any]:
    if not settings.GEMINI_API_KEY.strip():
        raise HTTPException(status_code=503, detail="Missing GEMINI_API_KEY in backend .env")

    system_prompt = (
        "You parse Vietnamese packing notes into structured issue lines.\n"
        "Return JSON only, with this exact shape: {\"title\": string|null, \"lines\": [...]}\n"
        "Each line object must include: raw_text, quantity, raw_name, unit, product_id, confidence.\n"
        "Rules:\n"
        "- The first non-empty line without a leading quantity is the title.\n"
        "- Each quantity line becomes one output line.\n"
        "- quantity must be an integer > 0.\n"
        "- raw_name should keep the human-readable product phrase without quantity.\n"
        "- unit should usually be SALE unless the text clearly mentions base/piece units.\n"
        "- product_id must be chosen only from the provided catalog when there is a strong match; otherwise null.\n"
        "- confidence should be from 0 to 1.\n"
        "- Do not invent catalog items.\n"
        "- Do not wrap JSON in markdown fences.\n"
    )

    body = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": json.dumps(
                            {
                                "note_text": note_text,
                                "catalog": _catalog_for_prompt(products),
                            },
                            ensure_ascii=False,
                        )
                    }
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
        },
    }

    endpoint = (
        f"{settings.GEMINI_BASE_URL.rstrip('/')}/models/"
        f"{settings.GEMINI_MODEL}:generateContent?{urlparse.urlencode({'key': settings.GEMINI_API_KEY})}"
    )
    req = urlrequest.Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(req, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urlerror.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"Gemini API error: {message or exc.reason}") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini API request failed: {exc}") from exc

    try:
        content = _extract_gemini_text(payload)
        return json.loads(content)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Invalid AI response while parsing issue note") from exc


def _local_match(raw_name: str, products: list[Product]) -> tuple[Product | None, float]:
    target = _normalize_text(raw_name)
    if not target:
        return None, 0.0

    best_product: Product | None = None
    best_score = 0.0

    for product in products:
        if not product.is_active:
            continue
        name_score = SequenceMatcher(None, target, _normalize_text(product.name)).ratio()
        sku_score = SequenceMatcher(None, target, _normalize_text(product.sku)).ratio()
        token_bonus = 0.0
        target_tokens = set(target.split())
        product_tokens = set(_normalize_text(product.name).split())
        if target_tokens and product_tokens:
            overlap = len(target_tokens & product_tokens) / max(len(target_tokens), 1)
            token_bonus = overlap * 0.25
        score = max(name_score, sku_score) + token_bonus
        if score > best_score:
            best_score = score
            best_product = product

    return best_product, min(best_score, 1.0)


def parse_issue_note(note_text: str, products: list[Product]) -> dict[str, Any]:
    ai_result = _call_gemini_parse(note_text, products)
    active_products = {product.id: product for product in products if product.is_active}
    warnings: list[str] = []
    parsed_lines: list[ParsedIssueLine] = []

    for row in ai_result.get("lines", []):
        raw_text = str(row.get("raw_text") or "").strip()
        raw_name = str(row.get("raw_name") or "").strip()
        quantity = int(row.get("quantity") or 0)
        unit = str(row.get("unit") or "SALE").upper()
        ai_product_id = row.get("product_id")
        ai_confidence = float(row.get("confidence") or 0)

        product = active_products.get(int(ai_product_id)) if isinstance(ai_product_id, int) else None
        confidence = ai_confidence
        match_source = "ai"

        if product is None:
            product, confidence = _local_match(raw_name or raw_text, list(active_products.values()))
            match_source = "fuzzy"

        if product is None or confidence < 0.45:
            warnings.append(f"Không match chắc chắn: {raw_text}")
            parsed_lines.append(
                ParsedIssueLine(
                    raw_text=raw_text,
                    raw_name=raw_name or raw_text,
                    quantity=max(quantity, 1),
                    unit="SALE" if unit not in {"SALE", "BASE"} else unit,
                    product_id=None,
                    sku=None,
                    matched_product_name=None,
                    confidence=max(confidence, 0.0),
                    match_source=match_source,
                )
            )
            continue

        parsed_lines.append(
            ParsedIssueLine(
                raw_text=raw_text,
                raw_name=raw_name or raw_text,
                quantity=max(quantity, 1),
                unit="SALE" if unit not in {"SALE", "BASE"} else unit,
                product_id=product.id,
                sku=product.sku,
                matched_product_name=product.name,
                confidence=confidence,
                match_source=match_source,
            )
        )

    return {
        "title": ai_result.get("title"),
        "lines": [line.__dict__ for line in parsed_lines],
        "warnings": warnings,
    }
