"""Licence status and activation.

- Activation time and the latest time seen are recorded per licence, HMAC-protected, in TWO places
  (a file in the data folder and the current user's registry). The earliest activation and latest
  "seen" time win, so deleting one copy does not reset anything.
- Time comes from the HTTPS `Date` header of well-known sites when online (the app needs internet
  anyway); offline, the local clock is used and a clock set back by more than a few hours is refused.
- Expiry = min(activation + days, activate_by + days): wiping all local data can never extend a key.

Determined attackers with full control of the machine can still defeat any offline scheme; this
raises the bar well beyond casual copying and clock changes.
"""

import hashlib
import hmac
import json
import logging
import math
import os
import sys
import threading
import time
import urllib.request
from datetime import date, datetime, time as dtime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

from app import _build_flags
from app.licensing import keys
from app.licensing.device import DeviceIdError, device_id, normalize
from app.licensing.public_key import PUBLIC_KEY_B64

logger = logging.getLogger(__name__)

# Mixed into the state HMAC; compiled into native code in packaged builds.
_STATE_PEPPER = b"pa-state-v1::7c1f0e9a4b2d46c8a3f5e1d0b9c8a7f6"
_TIME_URLS = ("https://www.google.com", "https://www.cloudflare.com", "https://www.microsoft.com")
_ROLLBACK_TOLERANCE = timedelta(hours=6)
_NETWORK_TIME_TTL = 6 * 3600
_STATUS_TTL = 60
_REG_PATH = os.environ.get("PA_LICENSE_REG_PATH", r"Software\PortfolioAnalyzer")
_REG_VALUE = "LicenseState"

MESSAGES = {
    "valid": "Licence active.",
    "missing": "No licence key has been entered on this device yet.",
    "invalid": "The stored licence key is not valid.",
    "wrong_device": "This licence key was issued for a different device.",
    "not_activated_in_time": "This licence key had to be activated by {activate_by}. Ask for a new key.",
    "expired": "Your licence expired on {expires}. Ask for a renewal key.",
    "clock_tampered": "Your computer's date appears to be set in the past. Correct the date and time, then restart the app.",
    "build_expired": "This version of the app stopped working on {date}. Ask for the latest installer.",
    "device_error": "This device could not be identified: {error}",
}


def default_data_dir() -> Path:
    if os.environ.get("PA_DATA_DIR"):
        return Path(os.environ["PA_DATA_DIR"])
    if sys.platform == "win32" and os.environ.get("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / "PortfolioAnalyzer"
    return Path.home() / ".portfolio-analyzer"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def _end_of_day(d: str) -> datetime:
    return datetime.combine(date.fromisoformat(d), dtime(23, 59, 59), tzinfo=timezone.utc)


# --- Network time ---------------------------------------------------------------------------

_net_cache: tuple[float, timedelta | None] | None = None
_net_lock = threading.Lock()


def _network_offset() -> timedelta | None:
    """Offset (network - local). Cached for a few hours; None when offline."""
    global _net_cache
    with _net_lock:
        if _net_cache and time.monotonic() - _net_cache[0] < _NETWORK_TIME_TTL:
            return _net_cache[1]
        offset = None
        for url in _TIME_URLS:
            try:
                req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "PortfolioAnalyzer"})
                with urllib.request.urlopen(req, timeout=4) as resp:
                    header = resp.headers.get("Date")
                if header:
                    offset = parsedate_to_datetime(header) - _now_utc()
                    break
            except Exception:  # noqa: BLE001 - offline / blocked: try the next source
                continue
        _net_cache = (time.monotonic(), offset)
        return offset


# --- Tamper-evident activation records ------------------------------------------------------


class _StateStore:
    def __init__(self, data_dir: Path, dev_id: str):
        self.file = data_dir / "license" / "state.json"
        self.key = hashlib.sha256(_STATE_PEPPER + dev_id.encode()).digest()

    def _mac(self, records: dict) -> str:
        return hmac.new(self.key, keys.canonical(records), hashlib.sha256).hexdigest()

    def _decode(self, raw: str | None) -> dict:
        if not raw:
            return {}
        try:
            blob = json.loads(raw)
            records = blob["records"]
            if hmac.compare_digest(blob["mac"], self._mac(records)):
                return records
            logger.warning("Ignoring licence state with an invalid signature")
        except Exception:  # noqa: BLE001
            logger.warning("Ignoring unreadable licence state")
        return {}

    def _read_registry(self) -> str | None:
        if sys.platform != "win32":
            return None
        import winreg

        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _REG_PATH) as k:
                return str(winreg.QueryValueEx(k, _REG_VALUE)[0])
        except OSError:
            return None

    def _write_registry(self, raw: str) -> None:
        if sys.platform != "win32":
            return
        import winreg

        try:
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, _REG_PATH) as k:
                winreg.SetValueEx(k, _REG_VALUE, 0, winreg.REG_SZ, raw)
        except OSError as exc:
            logger.warning("Could not mirror licence state to the registry: %s", exc)

    def load(self) -> dict:
        file_raw = self.file.read_text(encoding="utf-8") if self.file.exists() else None
        merged: dict = {}
        for records in (self._decode(file_raw), self._decode(self._read_registry())):
            for lid, rec in records.items():
                cur = merged.setdefault(lid, dict(rec))
                cur["activated"] = min(cur["activated"], rec["activated"])
                cur["last_seen"] = max(cur["last_seen"], rec["last_seen"])
        return merged

    def save(self, records: dict) -> None:
        raw = json.dumps({"records": records, "mac": self._mac(records)}, separators=(",", ":"))
        self.file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(raw, encoding="utf-8")
        tmp.replace(self.file)
        self._write_registry(raw)


# --- Manager -------------------------------------------------------------------------------


class LicenseManager:
    def __init__(self, data_dir: Path | None = None, public_key_b64: str | None = None, clock=None, network_offset=None):
        self.data_dir = data_dir or default_data_dir()
        self.key_file = self.data_dir / "license" / "license.key"
        self.public_key = public_key_b64 or PUBLIC_KEY_B64
        self._clock = clock or _now_utc  # injectable for tests
        self._network_offset = network_offset if network_offset is not None else _network_offset
        self._lock = threading.Lock()
        self._cached: tuple[float, dict] | None = None

    @property
    def enforced(self) -> bool:
        return bool(_build_flags.REQUIRE_LICENSE)

    def _times(self) -> tuple[datetime, str]:
        local = self._clock()
        offset = self._network_offset()
        return (local + offset, "network") if offset is not None else (local, "local")

    def _result(self, state: str, dev: str | None, payload: dict | None = None, time_source: str = "local", **fmt) -> dict:
        return {
            "enforced": self.enforced,
            "state": state,
            "valid": state == "valid",
            "message": MESSAGES[state].format(**fmt),
            "device_id": dev,
            "licensee": payload.get("name") if payload else None,
            "license_id": payload.get("lid") if payload else None,
            "expires_at": fmt.get("expires_at"),
            "days_left": fmt.get("days_left"),
            "time_source": time_source,
            "build_version": _build_flags.BUILD_VERSION,
        }

    def _evaluate(self, key: str | None) -> dict:
        try:
            dev = device_id()
        except DeviceIdError as exc:
            return self._result("device_error", None, error=str(exc))

        now, source = self._times()
        if _build_flags.BUILD_HARD_EXPIRY and now > _end_of_day(_build_flags.BUILD_HARD_EXPIRY):
            return self._result("build_expired", dev, time_source=source, date=_build_flags.BUILD_HARD_EXPIRY)
        if not key:
            return self._result("missing", dev, time_source=source)

        try:
            payload = keys.verify_key(key, self.public_key)
        except keys.LicenseKeyError as exc:
            res = self._result("invalid", dev, time_source=source)
            res["message"] = str(exc)
            return res
        if normalize(payload["device"]) != dev:
            return self._result("wrong_device", dev, payload, source)

        store = _StateStore(self.data_dir, dev)
        records = store.load()
        lid = payload["lid"]
        rec = records.get(lid)
        activate_by = _end_of_day(payload["activate_by"])

        if source == "local" and rec and now < datetime.fromisoformat(rec["last_seen"]) - _ROLLBACK_TOLERANCE:
            return self._result("clock_tampered", dev, payload, source)

        if rec is None:
            # First activation here (or local records were wiped): record it. activate_by bounds both cases.
            if now > activate_by:
                return self._result("not_activated_in_time", dev, payload, source, activate_by=payload["activate_by"])
            rec = {"activated": _iso(now), "last_seen": _iso(now)}
            records[lid] = rec
            store.save(records)

        days = timedelta(days=int(payload["days"]))
        expires = min(datetime.fromisoformat(rec["activated"]) + days, activate_by + days)
        if now >= expires:
            return self._result("expired", dev, payload, source, expires=expires.date().isoformat(), expires_at=_iso(expires), days_left=0)

        if now - datetime.fromisoformat(rec["last_seen"]) > timedelta(hours=1):
            rec["last_seen"] = _iso(max(now, datetime.fromisoformat(rec["last_seen"])))
            store.save(records)

        days_left = max(0, math.ceil((expires - now).total_seconds() / 86400))
        return self._result("valid", dev, payload, source, expires_at=_iso(expires), days_left=days_left)

    def status(self, force: bool = False) -> dict:
        with self._lock:
            if not force and self._cached and time.monotonic() - self._cached[0] < _STATUS_TTL:
                return self._cached[1]
            key = self.key_file.read_text(encoding="utf-8").strip() if self.key_file.exists() else None
            result = self._evaluate(key)
            self._cached = (time.monotonic(), result)
            return result

    def activate(self, key: str) -> dict:
        with self._lock:
            key = keys.clean(key)
            result = self._evaluate(key)
            if result["state"] in ("valid", "expired"):
                # Keep an expired-but-authentic key too, so the app can explain what happened.
                self.key_file.parent.mkdir(parents=True, exist_ok=True)
                self.key_file.write_text(key, encoding="utf-8")
            self._cached = None
            return result


_manager: LicenseManager | None = None


def get_manager() -> LicenseManager:
    global _manager
    if _manager is None:
        _manager = LicenseManager()
    return _manager
