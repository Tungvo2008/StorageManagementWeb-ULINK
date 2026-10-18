from __future__ import annotations

import json
import logging
import urllib.request
from typing import Any, Optional
from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)


class AddressInput(BaseModel):
    name: str = "Customer"
    street1: str
    street2: Optional[str] = None
    city: str
    state: str
    zip: str
    country: str = "US"
    phone: Optional[str] = None
    email: Optional[str] = None


class ParcelInput(BaseModel):
    length: float = Field(default=12.0, description="Inches")
    width: float = Field(default=10.0, description="Inches")
    height: float = Field(default=6.0, description="Inches")
    weight: float = Field(default=5.0, description="Pounds (lbs)")


class ShippingRateItem(BaseModel):
    carrier: str  # USPS, UPS
    service_name: str
    amount: float
    currency: str = "USD"
    estimated_days: Optional[int] = None
    duration_terms: Optional[str] = None
    rate_id: str


class ShippingRateResponse(BaseModel):
    success: bool
    carrier_rates: list[ShippingRateItem]
    lowest_rate: Optional[ShippingRateItem] = None
    fastest_rate: Optional[ShippingRateItem] = None
    error_message: Optional[str] = None


def get_shippo_shipping_rates(
    address_to: AddressInput,
    parcel: ParcelInput,
    address_from: Optional[AddressInput] = None,
) -> ShippingRateResponse:
    """
    Tra cứu bảng giá cước vận chuyển thời gian thực từ Shippo API (USPS Commercial & UPS DAP).
    Hoàn toàn miễn phí, tốc độ phản hồi cao, không cần Captcha.
    """
    token = getattr(settings, "SHIPPO_API_TOKEN", "")
    if not token:
        return ShippingRateResponse(
            success=False,
            carrier_rates=[],
            error_message="SHIPPO_API_TOKEN is not configured on backend."
        )

    # Sử dụng kho Dallas mặc định nếu không truyền address_from
    from_dict = {
        "name": address_from.name if address_from else settings.DEFAULT_WAREHOUSE_NAME,
        "street1": address_from.street1 if address_from else settings.DEFAULT_WAREHOUSE_STREET,
        "city": address_from.city if address_from else settings.DEFAULT_WAREHOUSE_CITY,
        "state": address_from.state if address_from else settings.DEFAULT_WAREHOUSE_STATE,
        "zip": address_from.zip if address_from else settings.DEFAULT_WAREHOUSE_ZIP,
        "country": address_from.country if address_from else settings.DEFAULT_WAREHOUSE_COUNTRY,
        "phone": address_from.phone if address_from else settings.DEFAULT_WAREHOUSE_PHONE,
    }

    to_dict = {
        "name": address_to.name,
        "street1": address_to.street1,
        "city": address_to.city,
        "state": address_to.state,
        "zip": address_to.zip,
        "country": address_to.country,
    }
    if address_to.street2:
        to_dict["street2"] = address_to.street2
    if address_to.phone:
        to_dict["phone"] = address_to.phone
    if address_to.email:
        to_dict["email"] = address_to.email

    parcel_dict = {
        "length": str(parcel.length),
        "width": str(parcel.width),
        "height": str(parcel.height),
        "distance_unit": "in",
        "weight": str(parcel.weight),
        "mass_unit": "lb",
    }

    payload = {
        "address_from": from_dict,
        "address_to": to_dict,
        "parcels": [parcel_dict],
        "async": False,
    }

    url = "https://api.goshippo.com/shipments/"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"ShippoToken {token}",
            "Content-Type": "application/json",
            "User-Agent": "ULINK-Storage-Service/1.0",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.error(f"[Shippo API] Error getting rates: {e}")
        return ShippingRateResponse(
            success=False,
            carrier_rates=[],
            error_message=f"Shippo API error: {str(e)}"
        )

    raw_rates = data.get("rates", [])
    parsed_rates: list[ShippingRateItem] = []

    for r in raw_rates:
        carrier = r.get("provider", "")
        service_info = r.get("servicelevel") or {}
        service_name = service_info.get("name") or carrier
        amount_val = float(r.get("amount") or 0.0)
        currency = r.get("currency") or "USD"
        est_days = r.get("estimated_days")
        duration_terms = r.get("duration_terms")
        rate_id = r.get("object_id") or ""

        parsed_rates.append(
            ShippingRateItem(
                carrier=carrier,
                service_name=service_name,
                amount=amount_val,
                currency=currency,
                estimated_days=est_days,
                duration_terms=duration_terms,
                rate_id=rate_id,
            )
        )

    # Sắp xếp theo giá tăng dần
    parsed_rates.sort(key=lambda x: x.amount)

    lowest = parsed_rates[0] if parsed_rates else None
    
    # Tìm gói nhanh nhất (ít ngày nhất)
    fastest = None
    rates_with_days = [r for r in parsed_rates if r.estimated_days and r.estimated_days > 0]
    if rates_with_days:
        rates_with_days.sort(key=lambda x: (x.estimated_days, x.amount))
        fastest = rates_with_days[0]

    return ShippingRateResponse(
        success=True,
        carrier_rates=parsed_rates,
        lowest_rate=lowest,
        fastest_rate=fastest,
    )
