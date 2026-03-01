from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

from app.core.config import settings


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    s = data.encode("ascii")
    pad = b"=" * ((4 - (len(s) % 4)) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _json_dumps(obj: Any) -> bytes:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def jwt_encode(payload: dict[str, Any], secret: str, *, alg: str = "HS256") -> str:
    if alg != "HS256":
        raise ValueError("Unsupported alg")
    header = {"typ": "JWT", "alg": alg}
    segments = [_b64url_encode(_json_dumps(header)), _b64url_encode(_json_dumps(payload))]
    signing_input = ".".join(segments).encode("ascii")
    sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    segments.append(_b64url_encode(sig))
    return ".".join(segments)


def jwt_decode(token: str, secret: str, *, alg: str = "HS256") -> dict[str, Any]:
    if alg != "HS256":
        raise ValueError("Unsupported alg")
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid token")
    header_b64, payload_b64, sig_b64 = parts
    header = json.loads(_b64url_decode(header_b64))
    if header.get("alg") != alg:
        raise ValueError("Invalid token")
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    got_sig = _b64url_decode(sig_b64)
    if not hmac.compare_digest(expected_sig, got_sig):
        raise ValueError("Invalid token")
    payload = json.loads(_b64url_decode(payload_b64))
    if not isinstance(payload, dict):
        raise ValueError("Invalid token")
    exp = payload.get("exp")
    if exp is not None:
        try:
            exp_i = int(exp)
        except Exception:
            raise ValueError("Invalid token")
        if int(time.time()) >= exp_i:
            raise ValueError("Token expired")
    return payload


def create_access_token(*, subject: str, expires_minutes: int | None = None, extra: dict[str, Any] | None = None) -> str:
    exp_minutes = int(expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    now = int(time.time())
    payload: dict[str, Any] = {"sub": subject, "exp": now + exp_minutes * 60}
    if extra:
        payload.update(extra)
    return jwt_encode(payload, settings.JWT_SECRET_KEY, alg=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    return jwt_decode(token, settings.JWT_SECRET_KEY, alg=settings.JWT_ALGORITHM)


def get_password_hash(password: str) -> str:
    iterations = 200_000
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${_b64url_encode(salt)}${_b64url_encode(dk)}"


def verify_password(plain_password: str, password_hash: str) -> bool:
    try:
        scheme, iter_s, salt_b64, hash_b64 = password_hash.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(iter_s)
        salt = _b64url_decode(salt_b64)
        expected = _b64url_decode(hash_b64)
    except Exception:
        return False

    dk = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(dk, expected)

