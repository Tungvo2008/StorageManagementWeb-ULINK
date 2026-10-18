from __future__ import annotations

import re
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user
from app.db.models import User

router = APIRouter(prefix="/system")


class SqlQueryRequest(BaseModel):
    query: str
    limit: Optional[int] = 50


@router.post("/sql-query")
def execute_sql_query(
    payload: SqlQueryRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = payload.query.strip()
    if not q:
        raise HTTPException(status_code=400, detail="Câu lệnh SQL không được để trống")

    # Security check: Read-only queries only
    first_word = q.split()[0].upper() if q.split() else ""
    if first_word not in ("SELECT", "PRAGMA", "EXPLAIN", "WITH"):
        raise HTTPException(
            status_code=400,
            detail="Chỉ cho phép các câu lệnh truy vấn dữ liệu đọc (SELECT, PRAGMA, WITH)",
        )

    # Check for destructive keywords
    tokens = re.findall(r"\b[A-Za-z_]+\b", q.upper())
    forbidden = {"INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "ATTACH", "DETACH"}
    found_forbidden = forbidden.intersection(tokens)
    if found_forbidden:
        raise HTTPException(
            status_code=400,
            detail=f"Không được phép dùng từ khóa sửa đổi dữ liệu: {', '.join(found_forbidden)}",
        )

    try:
        result = db.execute(text(q))
        keys = list(result.keys()) if result.returns_rows else []
        rows = []
        if result.returns_rows:
            fetch_limit = min(payload.limit or 50, 100)
            for r in result.fetchmany(fetch_limit):
                row_dict = {}
                for k, v in zip(keys, r):
                    # Convert non-serializable objects (like datetime or Decimal) to str/float
                    if hasattr(v, "isoformat"):
                        row_dict[k] = v.isoformat()
                    elif hasattr(v, "as_tuple"):
                        row_dict[k] = float(v)
                    else:
                        row_dict[k] = v
                rows.append(row_dict)
        return {
            "status": "ok",
            "columns": keys,
            "row_count": len(rows),
            "rows": rows,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Lỗi SQL: {e}")
