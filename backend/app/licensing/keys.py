"""Licence key format: PA1-<base64url(payload JSON)>.<base64url(Ed25519 signature)>

Payload fields:
  v            format version (1)
  product      "PA"
  lid          random licence id
  name         licensee (shown in the app)
  device       device id the key is valid for
  days         validity in days, counted from activation on that device
  issued       YYYY-MM-DD
  activate_by  YYYY-MM-DD: the key must be activated by this date. It also caps the expiry at
               activate_by + days, so wiping local activation data can never extend a licence.
"""

import base64
import json
from datetime import date

# `cryptography` is imported inside the functions that need it, so the development server (where
# licences are not enforced) keeps running even before `pip install -r requirements.txt` is re-run.

PREFIX = "PA1-"
PRODUCT = "PA"


class LicenseKeyError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sign_key(payload: dict, private_key) -> str:
    body = canonical(payload)
    return f"{PREFIX}{_b64e(body)}.{_b64e(private_key.sign(body))}"


def clean(key: str) -> str:
    return "".join(key.split())


def verify_key(key: str, public_key_b64: str) -> dict:
    """Return the payload if the key is authentic and well-formed; raise LicenseKeyError otherwise."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    key = clean(key)
    if not key.startswith(PREFIX) or key.count(".") != 1:
        raise LicenseKeyError("invalid", "This is not a Portfolio Analyzer licence key.")
    body_b64, sig_b64 = key[len(PREFIX) :].split(".")
    try:
        body, sig = _b64d(body_b64), _b64d(sig_b64)
        public_key = Ed25519PublicKey.from_public_bytes(_b64d(public_key_b64))
    except Exception as exc:  # noqa: BLE001
        raise LicenseKeyError("invalid", "The licence key is damaged. Copy it again in full.") from exc
    try:
        public_key.verify(sig, body)
    except InvalidSignature as exc:
        raise LicenseKeyError("invalid", "The licence key is not valid.") from exc

    payload = json.loads(body)
    required = {"v", "product", "lid", "name", "device", "days", "issued", "activate_by"}
    if payload.get("v") != 1 or payload.get("product") != PRODUCT or not required <= payload.keys():
        raise LicenseKeyError("invalid", "The licence key is for a different product or version.")
    try:
        date.fromisoformat(payload["issued"])
        date.fromisoformat(payload["activate_by"])
        if int(payload["days"]) <= 0:
            raise ValueError
    except (ValueError, TypeError) as exc:
        raise LicenseKeyError("invalid", "The licence key contains invalid dates.") from exc
    return payload
