from __future__ import annotations

import argparse
from pathlib import Path
import sys

# Allow running as: `python scripts/set_currency.py ...`
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import text

from app.db.session import engine


def main() -> int:
    parser = argparse.ArgumentParser(description="Set currency across DB tables (SQLite)")
    parser.add_argument("--to", required=True, help="Target currency code, e.g. USD")
    parser.add_argument(
        "--from",
        dest="from_currency",
        default="",
        help="Optional: only update rows with this currency (e.g. VND). If empty, updates non-matching currencies.",
    )
    args = parser.parse_args()

    to_cur = (args.to or "").strip().upper()
    if not to_cur:
        raise SystemExit("--to is required")

    from_cur = (args.from_currency or "").strip().upper()

    stmts: list[tuple[str, str]] = [
        ("products", "currency"),
        ("sale_orders", "currency"),
        ("invoices", "currency"),
    ]

    total = 0
    with engine.begin() as conn:
        for table, col in stmts:
            if from_cur:
                res = conn.execute(
                    text(f"UPDATE {table} SET {col}=:to WHERE {col}=:from"),
                    {"to": to_cur, "from": from_cur},
                )
            else:
                res = conn.execute(
                    text(f"UPDATE {table} SET {col}=:to WHERE {col} IS NULL OR {col}='' OR {col}!=:to"),
                    {"to": to_cur},
                )
            total += int(res.rowcount or 0)

    print(f"Updated rows: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

