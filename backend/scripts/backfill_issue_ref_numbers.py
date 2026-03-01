from __future__ import annotations

from pathlib import Path
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

# Allow running as: `python scripts/backfill_issue_ref_numbers.py`
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.models import InventoryIssue
from app.db.session import engine

PREFIX = "IS"
DIGITS = 4


def _parse_seq(ref: str) -> int | None:
    if not ref:
        return None
    raw = ref.strip()
    tail = raw[len(PREFIX):] if raw.startswith(PREFIX) else raw
    if not tail.isdigit():
        return None
    return int(tail)


def main() -> int:
    with Session(engine) as db:
        issues = db.scalars(select(InventoryIssue).order_by(InventoryIssue.issued_at.asc(), InventoryIssue.id.asc())).all()
        max_seq = 0
        for issue in issues:
            seq = _parse_seq(issue.issue_number or "")
            if seq is not None and seq > max_seq:
                max_seq = seq

        updated = 0
        next_seq = max_seq + 1
        for issue in issues:
            if (issue.issue_number or "").strip():
                continue
            issue.issue_number = f"{PREFIX}{next_seq:0{DIGITS}d}"
            next_seq += 1
            updated += 1

        db.commit()

    print("Issue ref backfill done.")
    print(f"- updated: {updated}")
    print(f"- next seq: {next_seq}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
