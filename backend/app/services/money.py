from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

MONEY_QUANT = Decimal("0.01")


def quantize_money(amount: Decimal) -> Decimal:
    return amount.quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)

